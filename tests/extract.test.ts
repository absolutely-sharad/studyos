import { describe, expect, it } from "vitest";
import { DocumentError, extractDocument, MAX_PDF_PAGES } from "@/lib/documents/extract";

/** A valid PDF with one page per entry; the text is drawn on the page (empty strings give blank pages). */
function pdfWithPages(pages: string[]): Buffer {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((text, i) => {
    const id = pageIds[i];
    // Wrap into lines: text running past the page edge is clipped and wouldn't be extracted.
    const lines = text.match(/.{1,60}(\s|$)/g) ?? [];
    const stream = lines.map((line, n) => `BT /F1 12 Tf 50 ${740 - n * 16} Td (${line.trim()}) Tj ET`).join("\n");
    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${id + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objects[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describe("extractDocument", () => {
  it("reads text page by page with page numbers", async () => {
    const long = "Binary search trees and graph traversal. ".repeat(10);
    const result = await extractDocument(pdfWithPages([long, `Second page. ${long}`]), "pdf");
    expect(result.pageCount).toBe(2);
    expect(result.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(result.pages[0].text).toContain("Binary search trees");
    expect(result.pages[1].text).toContain("Second page");
    expect(result.confidence).toBe(1);
  });

  it("gives a blank (scanned-looking) PDF low confidence", async () => {
    const result = await extractDocument(pdfWithPages(["", ""]), "pdf");
    expect(result.confidence).toBeLessThan(0.35);
  });

  it(`refuses a PDF over ${MAX_PDF_PAGES} pages with a message the student can act on`, async () => {
    const err = await extractDocument(pdfWithPages(Array(MAX_PDF_PAGES + 1).fill("")), "pdf").catch((e) => e);
    expect(err).toBeInstanceOf(DocumentError);
    expect(err.message).toContain(`${MAX_PDF_PAGES + 1} pages`);
    expect(err.message).toMatch(/smaller files/);
  });

  it(`accepts a PDF at exactly the limit`, async () => {
    const result = await extractDocument(pdfWithPages(Array(MAX_PDF_PAGES).fill("")), "pdf");
    expect(result.pageCount).toBe(MAX_PDF_PAGES);
  });

  it("reads plain text", async () => {
    const result = await extractDocument(Buffer.from("Unit 1: Arrays\nUnit 2: Trees"), "text");
    expect(result.pages).toEqual([{ page: null, text: "Unit 1: Arrays\nUnit 2: Trees" }]);
    expect(result.confidence).toBe(1);
  });
});
