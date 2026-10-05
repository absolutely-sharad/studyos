import { describe, expect, it } from "vitest";
import { DocumentError, extractDocument, MAX_PDF_PAGES } from "@/lib/documents/extract";
import { pdfWithPages } from "./helpers/pdf";

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
