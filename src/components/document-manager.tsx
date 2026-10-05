"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteDocument, setDocumentCategory } from "@/actions/documents";
import { Badge, Button, cx, inputBase } from "@/components/ui";
import { categoryFromName } from "@/lib/documents/categorize";
import { CATEGORY_LABELS, type DocumentView } from "@/lib/documents/serialize";

const IN_PROGRESS = new Set(["UPLOADED", "EXTRACTING", "CHUNKING"]);
const STAGES = [
  { status: "UPLOADED", label: "Queued" },
  { status: "EXTRACTING", label: "Reading text" },
  { status: "CHUNKING", label: "Indexing pages" },
  { status: "READY", label: "Ready" },
];
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_BATCH = 20;
const PARALLEL = 3;
const ACCEPT = /\.(pdf|docx|txt|md)$/i;

type QueueItem = {
  key: string;
  file: File;
  /** "AUTO" lets the server detect the type from the file name and then the content. */
  category: string;
  label: string;
  progress: number;
  state: "waiting" | "uploading" | "failed";
  error?: string;
};

const COUNT_LABEL: Record<string, [string, string]> = {
  SYLLABUS: ["syllabus", "syllabus files"],
  NOTES: ["notes file", "notes files"],
  TEXTBOOK: ["textbook", "textbooks"],
  PYQ: ["previous-year paper", "previous-year papers"],
  QUESTION_BANK: ["question bank", "question banks"],
  REVISION_NOTES: ["revision notes file", "revision notes files"],
  OTHER: ["other file", "other files"],
};
const countLabel = (category: string, n: number) => `${n} ${(COUNT_LABEL[category] ?? [category, category])[n === 1 ? 0 : 1]}`;

function sizeLabel(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** XHR rather than fetch: it reports upload progress. */
function uploadFile(file: File, category: string, onProgress: (p: number) => void): Promise<string | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve(null);
      let message = "Upload failed. Try again.";
      try {
        message = (JSON.parse(xhr.responseText) as { error?: string }).error ?? message;
      } catch {}
      resolve(message);
    };
    xhr.onerror = () => resolve("Network error. Check your connection and retry.");
    const body = new FormData();
    body.set("file", file);
    body.set("category", category);
    xhr.send(body);
  });
}

function StatusLine({ doc }: { doc: DocumentView }) {
  if (doc.status === "READY") return <Badge tone="good">Ready{doc.pageCount ? `, ${doc.pageCount} page${doc.pageCount === 1 ? "" : "s"}` : ""}</Badge>;
  if (doc.status === "FAILED") return <Badge tone="risk">Couldn't read this file</Badge>;
  if (doc.status === "NEEDS_OCR") return <Badge tone="warn">Scanned PDF</Badge>;
  const current = STAGES.findIndex((s) => s.status === doc.status);
  return (
    <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-live="polite">
      {STAGES.map((s, i) => (
        <li key={s.status} className={cx(i < current ? "text-sage" : i === current ? "font-bold text-ink" : "text-muted")}>
          {i < current ? "✓ " : i === current ? "… " : ""}
          {s.label}
        </li>
      ))}
    </ol>
  );
}

/** Explains how the type was decided, or suggests one when the content disagrees with the student's choice. */
function DetectionNote({ doc, onUse }: { doc: DocumentView; onUse: (category: string) => void }) {
  if (doc.status !== "READY") return null;
  if (doc.categorySource === "CONTENT")
    return <p className="text-sm text-muted">Detected from its content. {doc.detectionNote}</p>;
  if (doc.categorySource === "NAME")
    return <p className="text-sm text-muted">Type guessed from the file name. Change it if it's wrong.</p>;
  if (doc.detectedCategory && doc.detectedCategory !== doc.category) {
    const label = CATEGORY_LABELS[doc.detectedCategory];
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-marigold-soft px-2.5 py-1.5 text-sm">
        <span>
          This looks like a {label.toLowerCase()}. {doc.detectionNote}
        </span>
        <Button type="button" size="sm" variant="secondary" onClick={() => onUse(doc.detectedCategory!)}>
          Change to {label.toLowerCase()}
        </Button>
      </div>
    );
  }
  return null;
}

function CategorySelect({ value, onChange, label, includeAuto }: { value: string; onChange: (v: string) => void; label: string; includeAuto?: boolean }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={cx(inputBase, "h-8 w-auto px-2 text-sm")}>
      {includeAuto && <option value="AUTO">Detect from file name</option>}
      {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

export function DocumentManager({ initial }: { initial: DocumentView[] }) {
  const router = useRouter();
  const [docs, setDocs] = useState(initial);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [category, setCategory] = useState("AUTO");
  const [dragging, setDragging] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const wasProcessing = useRef(initial.some((d) => IN_PROGRESS.has(d.status)));
  const docsRef = useRef(docs);
  useEffect(() => {
    docsRef.current = docs;
  });

  // Take the server's list whenever it is re-rendered with a new one (after router.refresh()).
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setDocs(initial);
  }

  const poll = useCallback(async () => {
    const res = await fetch("/api/documents", { cache: "no-store" });
    if (!res.ok) return;
    const { documents } = (await res.json()) as { documents: DocumentView[] };
    setDocs(documents);
    const processing = documents.some((d) => IN_PROGRESS.has(d.status));
    if (wasProcessing.current && !processing) router.refresh();
    wasProcessing.current = processing;
  }, [router]);

  const processing = docs.some((d) => IN_PROGRESS.has(d.status));
  useEffect(() => {
    if (!processing) return;
    const id = setInterval(poll, 1500);
    return () => clearInterval(id);
  }, [processing, poll]);

  const patch = (key: string, p: Partial<QueueItem>) => setQueue((q) => q.map((it) => (it.key === key ? { ...it, ...p } : it)));

  async function runUploads(items: QueueItem[]) {
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const item = items[next++];
        patch(item.key, { state: "uploading", progress: 0, error: undefined });
        const error = await uploadFile(item.file, item.category, (p) => patch(item.key, { progress: p }));
        if (error) patch(item.key, { state: "failed", error });
        else {
          setQueue((q) => q.filter((it) => it.key !== item.key));
          wasProcessing.current = true;
          void poll();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
  }

  function addFiles(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (fileRef.current) fileRef.current.value = "";
    if (files.length === 0) return;
    const skipped: string[] = [];
    const accepted: QueueItem[] = [];
    for (const file of files) {
      if (!ACCEPT.test(file.name)) skipped.push(`${file.name} isn't a PDF, DOCX or TXT file.`);
      else if (file.size > MAX_BYTES) skipped.push(`${file.name} is larger than 25 MB.`);
      else if (file.size === 0) skipped.push(`${file.name} is empty.`);
      else if (docsRef.current.some((d) => d.filename === file.name && d.sizeBytes === file.size)) skipped.push(`${file.name} is already uploaded.`);
      else if (accepted.length >= MAX_BATCH) skipped.push(`${file.name} wasn't added. Upload up to ${MAX_BATCH} files at a time.`);
      else
        accepted.push({
          key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
          file,
          category,
          label:
            category === "AUTO"
              ? (() => {
                  const fromName = categoryFromName(file.name);
                  return fromName ? `Probably ${CATEGORY_LABELS[fromName].toLowerCase()}` : "Type detected after upload";
                })()
              : CATEGORY_LABELS[category],
          progress: 0,
          state: "waiting",
        });
    }
    setNotes(skipped);
    if (accepted.length === 0) return;
    setQueue((q) => [...q, ...accepted]);
    void runUploads(accepted);
  }

  const uploading = queue.filter((q) => q.state !== "failed");
  const counts = Object.entries(
    docs.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.category]: (acc[d.category] ?? 0) + 1 }), {}),
  );

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cx(
          "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
          dragging ? "border-ink bg-sky-soft" : "border-ink-soft/30 bg-paper",
        )}
      >
        <p className="font-display text-lg font-semibold">
          <span className="md:hidden">Add your PDFs</span>
          <span className="hidden md:inline">Drop your PDFs here</span>
        </p>
        <p className="text-sm text-muted">Select several at once: syllabus, notes, books and previous-year papers. Up to {MAX_BATCH} files at a time, 25 MB each.</p>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,application/pdf,text/plain"
          className="sr-only"
          id="upload"
          onChange={(e) => addFiles(e.target.files)}
        />
        <Button type="button" onClick={() => fileRef.current?.click()}>
          Choose files
        </Button>
        <label className="flex flex-wrap items-center justify-center gap-2 text-sm">
          <span className="text-muted">File type:</span>
          <CategorySelect value={category} onChange={setCategory} label="File type for new uploads" includeAuto />
        </label>
      </div>

      {notes.length > 0 && (
        <div role="alert" className="space-y-1 rounded-md bg-rose-soft px-3 py-2 text-sm text-rose">
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      {queue.length > 0 && (
        <section aria-label="Uploads" className="rounded-lg border border-rule bg-sheet">
          <p className="border-b border-rule px-4 py-2 text-sm font-bold" aria-live="polite">
            {uploading.length > 0 ? `Uploading ${uploading.length} file${uploading.length === 1 ? "" : "s"}…` : "Some files didn't upload"}
          </p>
          <ul className="divide-y divide-rule">
            {queue.map((it) => (
              <li key={it.key} className="space-y-1.5 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-bold" title={it.file.name}>
                    {it.file.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {it.label}, {sizeLabel(it.file.size)}
                  </span>
                </div>
                {it.state === "failed" ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-rose">{it.error}</span>
                    <Button type="button" size="sm" variant="secondary" onClick={() => runUploads([it])}>
                      Retry
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setQueue((q) => q.filter((x) => x.key !== it.key))}>
                      Dismiss
                    </Button>
                  </div>
                ) : (
                  <div
                    role="progressbar"
                    aria-label={`Uploading ${it.file.name}`}
                    aria-valuenow={Math.round(it.progress * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-1.5 rounded-full bg-rule"
                  >
                    <div className="h-full rounded-full bg-ink-soft transition-[width]" style={{ width: `${Math.round(it.progress * 100)}%` }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {docs.length > 0 && (
        <section aria-label="Your files" className="space-y-2">
          <p className="text-sm text-muted">
            {docs.length} file{docs.length === 1 ? "" : "s"}: {counts.map(([c, n]) => countLabel(c, n)).join(", ")}.
            {processing && ` ${docs.filter((d) => IN_PROGRESS.has(d.status)).length} still being read.`}
          </p>
          <ul className="divide-y divide-rule rounded-lg border border-rule bg-sheet">
            {docs.map((doc) => (
              <li key={doc.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-bold" title={doc.filename}>
                    {doc.filename}
                  </p>
                  <p className="text-sm text-muted">{sizeLabel(doc.sizeBytes)}</p>
                  <StatusLine doc={doc} />
                  {doc.error && <p className="text-sm text-rose">{doc.error}</p>}
                  <DetectionNote
                    doc={doc}
                    onUse={async (value) => {
                      setDocs((all) => all.map((d) => (d.id === doc.id ? { ...d, category: value, categorySource: "USER" } : d)));
                      await setDocumentCategory(doc.id, value);
                    }}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <CategorySelect
                    label={`Type of ${doc.filename}`}
                    value={doc.category}
                    onChange={async (value) => {
                      setDocs((all) => all.map((d) => (d.id === doc.id ? { ...d, category: value, categorySource: "USER" } : d)));
                      await setDocumentCategory(doc.id, value);
                    }}
                  />
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={async () => {
                      if (!confirm(`Remove ${doc.filename}?`)) return;
                      setDocs((all) => all.filter((d) => d.id !== doc.id));
                      await deleteDocument(doc.id);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
