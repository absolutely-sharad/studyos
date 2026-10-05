import type { Prisma } from "@/generated/prisma/client";
import type { DocumentCategory } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { singleton } from "@/lib/singleton";
import { readStoredFile, StorageNotFoundError } from "@/lib/storage";
import { DocumentError, detectKind } from "./extract";
import { analyze, processingConcurrency } from "./pool";
import { claimDocuments } from "./queue";

/**
 * Uploaded files are read in the background, off the web server's request path and, for the heavy part, off its
 * main thread (see pool.ts). The `documents` table is the queue: a file waits as UPLOADED (shown as "Queued"),
 * is claimed atomically (queue.ts), and moves through EXTRACTING and CHUNKING to READY.
 */

interface DrainState {
  running: Promise<void> | null;
  /** Someone asked for processing while a pass was already finishing: go round again before stopping. */
  again: boolean;
}
const state = singleton<DrainState>("document-drain", () => ({ running: null, again: false }));

/**
 * Reads every waiting file, a few at a time, and resolves when none are left. Safe to call from anywhere, any
 * number of times: concurrent callers share one pass. In `after()` it also keeps a serverless function alive
 * until the work is done.
 */
export function processPending(): Promise<void> {
  state.again = true;
  state.running ??= drain();
  return state.running;
}

async function drain() {
  try {
    while (state.again) {
      state.again = false;
      await passUntilEmpty();
    }
  } finally {
    // Cleared in the same turn as the check above, so a call can never land in a gap and be left unprocessed.
    state.running = null;
  }
}

async function passUntilEmpty() {
  const inFlight = new Set<Promise<void>>();
  const slots = processingConcurrency();
  for (;;) {
    while (inFlight.size < slots) {
      let claimed: string[];
      try {
        claimed = await claimDocuments(1);
      } catch (err) {
        log.error("could not claim documents", err);
        claimed = [];
      }
      if (claimed.length === 0) break;
      const job: Promise<void> = processOne(claimed[0])
        .catch((err) => log.error("document processing crashed", err, { documentId: claimed[0] }))
        .finally(() => inFlight.delete(job));
      inFlight.add(job);
    }
    if (inFlight.size === 0) return;
    await Promise.race(inFlight);
  }
}

/**
 * Starts a timer that looks for waiting files every 30 seconds, which is how files left behind by a restart,
 * or by another instance that went away, get picked up. Not needed (and not run) on serverless hosts, where
 * every upload and every file-list request starts processing itself.
 */
export function startQueueSweeper() {
  const sweeper = singleton<{ timer: ReturnType<typeof setInterval> | null }>("document-sweeper", () => ({ timer: null }));
  if (sweeper.timer || process.env.VERCEL) return;
  sweeper.timer = setInterval(() => void processPending(), 30_000);
  sweeper.timer.unref();
  void processPending();
}

/** Reads one claimed file. Its status is already EXTRACTING. */
async function processOne(documentId: string) {
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) return;
  try {
    const kind = detectKind(doc.filename, doc.mimeType);
    if (!kind) throw new DocumentError("This file type isn't supported. Upload a PDF, DOCX or TXT file.");
    const analysis = await analyze(await readStoredFile(doc.storageKey), kind, doc.filename);

    if (analysis.outcome === "needs-ocr") {
      await db.document.update({
        where: { id: doc.id },
        data: {
          status: "NEEDS_OCR",
          pageCount: analysis.pageCount,
          extractionConfidence: analysis.confidence,
          error: `Text extraction confidence is ${Math.round(analysis.confidence * 100)}% — this looks like a scanned PDF. OCR is coming soon; for now, paste the text into the box below, or upload a text-based PDF.`,
        },
      });
      return;
    }

    // Record what the text looks like. A category the student chose is never overwritten (checked in the
    // database, not from the copy read earlier, in case they changed it while the file was being read).
    const detected = analysis.detectedCategory as DocumentCategory | null;
    await db.document.update({
      where: { id: doc.id },
      data: {
        status: "CHUNKING",
        pageCount: analysis.pageCount,
        extractionConfidence: analysis.confidence,
        detectedCategory: detected,
        detectionNote: analysis.detectionNote,
      },
    });
    if (detected) await db.document.updateMany({ where: { id: doc.id, categorySource: { not: "USER" } }, data: { category: detected, categorySource: "CONTENT" } });
    await db.$transaction([
      db.documentChunk.deleteMany({ where: { documentId: doc.id } }),
      db.documentChunk.createMany({
        data: analysis.chunks.map((c) => ({
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
    // Parser errors can mention file paths and internals, so only our own messages reach the student.
    const message =
      err instanceof DocumentError
        ? err.message
        : err instanceof StorageNotFoundError
          ? "The file is missing from storage. Remove it and upload it again."
          : "We couldn't read this file. It may be damaged or password-protected. Try re-saving it as a new PDF, or upload a different copy.";
    if (!(err instanceof DocumentError)) log.error("document processing failed", err, { documentId: doc.id });
    // updateMany: the student may have removed the file while it was being read.
    await db.document.updateMany({ where: { id: doc.id }, data: { status: "FAILED", error: message } });
  }
}

/** Full text of a processed document, rebuilt from its chunks. Pass `client` to read inside a transaction. */
export async function documentText(documentId: string, client: Prisma.TransactionClient = db) {
  const chunks = await client.documentChunk.findMany({
    where: { documentId },
    orderBy: { chunkIndex: "asc" },
    select: { content: true },
  });
  return chunks.map((c) => c.content).join("\n\n");
}
