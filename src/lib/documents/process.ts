import { db } from "@/lib/db";
import { readStoredFile } from "@/lib/storage";
import { chunkPages } from "./chunk";
import { classifyDocument, describeReasons } from "./classify";
import { detectKind, extractDocument } from "./extract";

const OCR_THRESHOLD = 0.35;

// Students often upload many PDFs at once. Extraction is CPU- and memory-heavy, so each
// server instance reads at most a few files at a time; the rest wait as UPLOADED ("Queued").
const MAX_CONCURRENT = Math.max(1, Number(process.env.PROCESSING_CONCURRENCY) || 3);
let active = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next(); // hand the slot straight to the next file
    else active--;
  }
}

/** Runs after the upload response is sent. Each status maps to a real pipeline stage. */
export function processDocument(documentId: string) {
  return withSlot(() => processOne(documentId));
}

async function processOne(documentId: string) {
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) return;
  try {
    await db.document.update({ where: { id: doc.id }, data: { status: "EXTRACTING", error: null } });
    const kind = detectKind(doc.filename, doc.mimeType);
    if (!kind) throw new Error("This file type isn't supported. Upload a PDF, DOCX or TXT file.");
    const extraction = await extractDocument(await readStoredFile(doc.storageKey), kind);

    if (kind === "pdf" && extraction.confidence < OCR_THRESHOLD) {
      await db.document.update({
        where: { id: doc.id },
        data: {
          status: "NEEDS_OCR",
          pageCount: extraction.pageCount,
          extractionConfidence: extraction.confidence,
          error: `Text extraction confidence is ${Math.round(extraction.confidence * 100)}% — this looks like a scanned PDF. OCR is coming soon; for now, paste the text into the box below, or upload a text-based PDF.`,
        },
      });
      return;
    }

    // Detect what kind of material this is from its text. A category the student chose is never
    // overwritten; the detection is kept so the UI can suggest a change.
    const fullText = extraction.pages.map((p) => p.text).join("\n");
    const kindGuess = classifyDocument({
      text: fullText,
      // DOCX and TXT have no pages; ~3,000 characters is roughly one printed page.
      pageCount: extraction.pageCount ?? Math.max(1, Math.round(fullText.length / 3000)),
      filename: doc.filename,
    });
    const detected = kindGuess.confident ? kindGuess.category : null;
    await db.document.update({
      where: { id: doc.id },
      data: {
        status: "CHUNKING",
        pageCount: extraction.pageCount,
        extractionConfidence: extraction.confidence,
        detectedCategory: detected,
        detectionNote: detected ? describeReasons(kindGuess.reasons) : null,
        ...(detected && doc.categorySource !== "USER" && { category: detected, categorySource: "CONTENT" as const }),
      },
    });
    const chunks = chunkPages(extraction.pages);
    await db.$transaction([
      db.documentChunk.deleteMany({ where: { documentId: doc.id } }),
      db.documentChunk.createMany({
        data: chunks.map((c) => ({
          documentId: doc.id,
          chunkIndex: c.index,
          pageNumber: c.page,
          content: c.content,
          tokenCount: c.tokenCount,
        })),
      }),
    ]);
    await db.document.update({ where: { id: doc.id }, data: { status: "READY" } });
  } catch (err) {
    await db.document.update({
      where: { id: doc.id },
      data: { status: "FAILED", error: err instanceof Error ? err.message : "Processing failed." },
    });
  }
}

/** Full text of a processed document, rebuilt from its chunks. */
export async function documentText(documentId: string) {
  const chunks = await db.documentChunk.findMany({
    where: { documentId },
    orderBy: { chunkIndex: "asc" },
    select: { content: true },
  });
  return chunks.map((c) => c.content).join("\n\n");
}
