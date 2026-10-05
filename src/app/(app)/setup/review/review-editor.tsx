"use client";

import { useState, useTransition } from "react";
import {
  addDependency,
  addSubject,
  addTopic,
  confirmSyllabus,
  deleteSubject,
  deleteTopic,
  mergeTopics,
  moveTopic,
  removeDependency,
  updateSubject,
  updateTopic,
} from "@/actions/syllabus";
import { Badge, Button, Notice, cx, inputBase, inputClass } from "@/components/ui";
import { formatMinutes } from "@/lib/dates";

export interface ReviewTopic {
  id: string;
  name: string;
  chapter: string | null;
  importance: number;
  estimatedMinutes: number;
  aliases: string[];
  confidence: number;
  prerequisites: { dependencyId: string; topicId: string; name: string }[];
}
export interface ReviewSubject {
  id: string;
  name: string;
  level: string;
  topics: ReviewTopic[];
}

const LEVELS = [
  { value: "BEGINNER", label: "Beginner" },
  { value: "INTERMEDIATE", label: "Intermediate" },
  { value: "ADVANCED", label: "Advanced" },
  { value: "UNSURE", label: "Not sure" },
];
const IMPORTANCE = ["", "Low", "Below normal", "Normal", "High", "Critical"];

function InlineText({ value, onSave, label, className }: { value: string; onSave: (v: string) => void; label: string; className?: string }) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const v = draft.trim();
        if (v.length >= 2 && v !== value) onSave(v);
        else setDraft(value);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={cx("w-full rounded-md border border-transparent bg-transparent px-2 py-1 hover:border-rule focus:border-ink-soft focus:bg-sheet focus:outline-none", className)}
    />
  );
}

function TopicRow({
  topic,
  siblings,
  allTopics,
  run,
  first,
  last,
}: {
  topic: ReviewTopic;
  siblings: ReviewTopic[];
  allTopics: { id: string; name: string }[];
  run: (fn: () => Promise<unknown>) => void;
  first: boolean;
  last: boolean;
}) {
  const prereqIds = new Set(topic.prerequisites.map((p) => p.topicId));
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <div className="min-w-0 flex-1">
          <InlineText key={topic.name} value={topic.name} label="Topic name" onSave={(name) => run(() => updateTopic(topic.id, { name }))} className="font-bold" />
        </div>
        <label className="flex items-center gap-1 text-sm text-muted">
          <span className="sr-only">Estimated hours</span>
          <input
            type="number"
            min={0.25}
            max={20}
            step={0.25}
            key={topic.estimatedMinutes}
            defaultValue={topic.estimatedMinutes / 60}
            onBlur={(e) => {
              const minutes = Math.round((Number(e.target.value) * 60) / 5) * 5;
              if (minutes >= 15 && minutes !== topic.estimatedMinutes) run(() => updateTopic(topic.id, { estimatedMinutes: minutes }));
            }}
            className={cx(inputBase, "h-8 w-16 px-2 text-right text-sm")}
          />
          h
        </label>
        <select
          aria-label="Importance"
          value={topic.importance}
          onChange={(e) => run(() => updateTopic(topic.id, { importance: Number(e.target.value) }))}
          className={cx(inputBase, "h-8 w-auto text-sm px-3", topic.importance >= 4 && "border-marigold")}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {IMPORTANCE[n]}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-2 text-sm">
        {topic.confidence < 0.5 && <Badge tone="warn">Check this one</Badge>}
        {topic.aliases.length > 0 && <span className="text-muted">Also called {topic.aliases.slice(0, 3).join(", ")}</span>}
        {topic.prerequisites.map((p) => (
          <span key={p.dependencyId} className="inline-flex items-center gap-1 rounded bg-sky-soft px-1.5 py-0.5 text-xs text-ink-soft">
            Needs {p.name}
            <button type="button" aria-label={`Remove prerequisite ${p.name}`} onClick={() => run(() => removeDependency(p.dependencyId))} className="px-0.5 font-bold hover:text-rose">
              ×
            </button>
          </span>
        ))}
        <details className="relative">
          <summary className="cursor-pointer list-none rounded px-1.5 py-0.5 text-xs font-bold text-ink-soft hover:bg-sky-soft">More</summary>
          <div className="absolute z-10 mt-1 w-72 space-y-3 rounded-lg border border-rule bg-sheet p-3 shadow-lg">
            <label className="block space-y-1">
              <span className="text-xs font-bold">Must be studied after</span>
              <select
                defaultValue=""
                onChange={(e) => e.target.value && run(() => addDependency(topic.id, e.target.value))}
                className={cx(inputBase, "h-8 text-sm w-full px-3")}
              >
                <option value="">Choose a topic…</option>
                {allTopics.filter((t) => t.id !== topic.id && !prereqIds.has(t.id)).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-bold">Merge into another topic</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  const target = siblings.find((s) => s.id === e.target.value);
                  if (target && confirm(`Merge "${topic.name}" into "${target.name}"?`)) run(() => mergeTopics(topic.id, target.id));
                  e.target.value = "";
                }}
                className={cx(inputBase, "h-8 text-sm w-full px-3")}
              >
                <option value="">Choose a topic…</option>
                {siblings.filter((t) => t.id !== topic.id).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-1">
              <Button type="button" size="sm" variant="secondary" disabled={first} onClick={() => run(() => moveTopic(topic.id, "up"))}>
                Move up
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={last} onClick={() => run(() => moveTopic(topic.id, "down"))}>
                Move down
              </Button>
              <Button type="button" size="sm" variant="danger" onClick={() => run(() => deleteTopic(topic.id))}>
                Delete
              </Button>
            </div>
          </div>
        </details>
      </div>
    </li>
  );
}

function AddInline({ placeholder, label, onAdd }: { placeholder: string; label: string; onAdd: (v: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim().length < 2) return;
        onAdd(value.trim());
        setValue("");
      }}
    >
      <input aria-label={label} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className={cx(inputBase, "h-9 w-full px-3 text-[15px]")} />
      <Button type="submit" variant="secondary" size="sm" className="h-9">
        Add
      </Button>
    </form>
  );
}

export function ReviewEditor({ subjects, note, confirmed }: { subjects: ReviewSubject[]; note: string | null; confirmed: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      setError(null);
      try {
        const result = (await fn()) as { error?: string } | undefined;
        if (result?.error) setError(result.error);
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) return;
        setError("That change didn't save. Check the value and try again.");
      }
    });

  const allTopics = subjects.flatMap((s) => s.topics.map((t) => ({ id: t.id, name: t.name })));
  const totalMinutes = subjects.reduce((s, sub) => s + sub.topics.reduce((a, t) => a + t.estimatedMinutes, 0), 0);

  return (
    <div className="space-y-6 pb-24">
      <header>
        <h1 className="text-3xl font-bold">Here's what we understood</h1>
        <p className="mt-2 max-w-prose text-muted">
          {subjects.length} subject{subjects.length === 1 ? "" : "s"}, {allTopics.length} topics and about {formatMinutes(totalMinutes)} of study for an
          average student. Fix anything that's off, then set your level in each subject. Nothing is planned until you confirm.
        </p>
      </header>
      {note && <Notice tone="warn">{note}</Notice>}
      {confirmed && <Notice tone="info">This syllabus is already confirmed. Changes apply the next time you rebuild your plan.</Notice>}

      {subjects.map((subject) => {
        const chapters = [...new Set(subject.topics.map((t) => t.chapter ?? ""))];
        return (
          <section key={subject.id} className="rounded-lg border border-rule bg-sheet p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <InlineText key={subject.name} value={subject.name} label="Subject name" onSave={(name) => run(() => updateSubject(subject.id, { name }))} className="font-display text-xl font-semibold" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted">Your level</span>
                <select value={subject.level} onChange={(e) => run(() => updateSubject(subject.id, { level: e.target.value }))} className={cx(inputBase, "h-8 w-auto text-sm px-3")}>
                  {LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => confirm(`Delete ${subject.name} and its ${subject.topics.length} topics?`) && run(() => deleteSubject(subject.id))}
              >
                Delete subject
              </Button>
            </div>

            {chapters.map((chapter) => {
              const topics = subject.topics.filter((t) => (t.chapter ?? "") === chapter);
              return (
                <div key={chapter || "none"} className="mt-2">
                  {chapter && <h3 className="px-2 pt-2 text-sm font-bold text-muted">{chapter}</h3>}
                  <ul className="divide-y divide-rule">
                    {topics.map((t) => (
                      <TopicRow
                        key={t.id}
                        topic={t}
                        siblings={subject.topics}
                        allTopics={allTopics}
                        run={run}
                        first={subject.topics[0]?.id === t.id}
                        last={subject.topics.at(-1)?.id === t.id}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
            <div className="mt-3">
              <AddInline label={`Add a topic to ${subject.name}`} placeholder="Add a topic" onAdd={(name) => run(() => addTopic(subject.id, name))} />
            </div>
          </section>
        );
      })}

      <section className="rounded-lg border border-dashed border-rule p-4">
        <AddInline label="Add a subject" placeholder="Add a subject" onAdd={(name) => run(() => addSubject(name))} />
      </section>

      <div className="fixed inset-x-0 bottom-16 z-10 border-t border-rule bg-sheet/95 backdrop-blur md:bottom-0 md:left-60">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <p className="text-sm text-muted" aria-live="polite">
            {error ? <span className="text-rose">{error}</span> : pending ? "Saving…" : "Changes save as you go."}
          </p>
          {!confirmed && (
            <Button type="button" disabled={pending || allTopics.length === 0} onClick={() => run(() => confirmSyllabus())}>
              Confirm syllabus and build my plan
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
