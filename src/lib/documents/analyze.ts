import type { DocumentCategoryKey } from "./categorize";
import { chunkPages, type Chunk } from "./chunk";
import { classifyDocument, describeReasons } from "./classify";
import { extractDocument, type DocumentKind } from "./extract";

/** Below this share of real text a PDF is treated as a scan. */
const OCR_THRESHOLD = 0.35;

export type Analysis =
  | { outcome: "needs-ocr"; pageCount: number | null; confidence: number }
  | {
      outcome: "ready";
      pageCount: number | null;
      confidence: number;
      /** What the text looks like, or null when the evidence isn't clear enough to say. */
      detectedCategory: DocumentCategoryKey | null;
      detectionNote: string | null;
      chunks: Chunk[];
    };

/**
 * Everything that reads a file's contents and costs real CPU: parsing the PDF/DOCX, detecting what kind of
 * material it is, and cutting it into page-aware chunks. Pure (bytes in, plain data out) so it can run on a
 * worker thread (see pool.ts) and its result can be copied between threads.
 */
export async function analyzeDocument(data: Uint8Array, kind: DocumentKind, filename: string): Promise<Analysis> {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const extraction = await extractDocument(buffer, kind);

  if (kind === "pdf" && extraction.confidence < OCR_THRESHOLD)
    return { outcome: "needs-ocr", pageCount: extraction.pageCount, confidence: extraction.confidence };

  const fullText = extraction.pages.map((p) => p.text).join("\n");
  const guess = classifyDocument({
    text: fullText,
    // DOCX and TXT have no pages; ~3,000 characters is roughly one printed page.
    pageCount: extraction.pageCount ?? Math.max(1, Math.round(fullText.length / 3000)),
    filename,
  });
  return {
    outcome: "ready",
    pageCount: extraction.pageCount,
    confidence: extraction.confidence,
    detectedCategory: guess.confident ? guess.category : null,
    detectionNote: guess.confident ? describeReasons(guess.reasons) : null,
    chunks: chunkPages(extraction.pages),
  };
}
