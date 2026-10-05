export interface ExtractedPage {
  page: number | null;
  text: string;
}

export interface Extraction {
  pages: ExtractedPage[];
  pageCount: number | null;
  /** 0–1: how much real text we found. Low values on PDFs mean a scanned document. */
  confidence: number;
}

export type DocumentKind = "pdf" | "docx" | "text";

/** A failure whose message is safe to show the student (anything else is logged, not shown). */
export class DocumentError extends Error {}

/** Guards CPU and memory: a 25 MB PDF can still hold thousands of pages. */
export const MAX_PDF_PAGES = 1500;

export const ACCEPTED_TYPES: Record<string, DocumentKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "text",
  "text/markdown": "text",
};

export function detectKind(filename: string, mimeType: string): DocumentKind | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "txt" || ext === "md") return "text";
  return ACCEPTED_TYPES[mimeType] ?? null;
}

export async function extractDocument(data: Buffer, kind: DocumentKind): Promise<Extraction> {
  if (kind === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(data));
    if (pdf.numPages > MAX_PDF_PAGES)
      throw new DocumentError(`This PDF has ${pdf.numPages} pages. The limit is ${MAX_PDF_PAGES}. Split it into smaller files and upload those.`);
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = text.map((t, i) => ({ page: i + 1, text: t }));
    const chars = pages.reduce((s, p) => s + p.text.replace(/\s/g, "").length, 0);
    const perPage = totalPages > 0 ? chars / totalPages : 0;
    return { pages, pageCount: totalPages, confidence: Math.min(1, perPage / 300) };
  }
  if (kind === "docx") {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.extractRawText({ buffer: data });
    return { pages: [{ page: null, text: value }], pageCount: null, confidence: value.trim() ? 1 : 0 };
  }
  const text = data.toString("utf8");
  return { pages: [{ page: null, text }], pageCount: null, confidence: text.trim() ? 1 : 0 };
}
