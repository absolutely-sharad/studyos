import { describe, expect, it } from "vitest";
import { detectKind } from "@/lib/documents/extract";
import { contentDisposition, INLINE_KINDS, matchesKind, SAFE_MIME } from "@/lib/documents/validate";

const bytes = (s: string | number[]) => new Uint8Array(typeof s === "string" ? Buffer.from(s) : s);

describe("matchesKind", () => {
  it("accepts a PDF header, including junk before it", () => {
    expect(matchesKind(bytes("%PDF-1.7\n..."), "pdf")).toBe(true);
    expect(matchesKind(bytes("\n\n  junk %PDF-1.4"), "pdf")).toBe(true);
  });

  it("rejects HTML and other content named .pdf", () => {
    expect(matchesKind(bytes("<html><script>alert(1)</script></html>"), "pdf")).toBe(false);
    expect(matchesKind(bytes(" ".repeat(2000) + "%PDF-1.4"), "pdf")).toBe(false); // header too far in
  });

  it("accepts a ZIP that contains word/document.xml and nothing else as DOCX", () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("....word/document.xml....")]);
    expect(matchesKind(new Uint8Array(zip), "docx")).toBe(true);
  });

  it("rejects a plain ZIP, a non-ZIP and a tiny buffer as DOCX", () => {
    expect(matchesKind(new Uint8Array(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("other/file.txt")])), "docx")).toBe(false);
    expect(matchesKind(bytes("not a zip word/document.xml"), "docx")).toBe(false);
    expect(matchesKind(bytes([0x50, 0x4b]), "docx")).toBe(false);
  });

  it("accepts text, including non-Latin text, and rejects binary", () => {
    expect(matchesKind(bytes("Unit 1: Arrays\nUnit 2: Trees"), "text")).toBe(true);
    expect(matchesKind(bytes("इकाई 1: डेटा संरचनाएँ"), "text")).toBe(true);
    expect(matchesKind(bytes([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]), "text")).toBe(false);
  });

  it("works on a view into a larger buffer", () => {
    const backing = Buffer.concat([Buffer.from("xxxx"), Buffer.from("%PDF-1.4 hello")]);
    expect(matchesKind(new Uint8Array(backing.buffer, backing.byteOffset + 4, 14), "pdf")).toBe(true);
  });
});

describe("what a file is served as", () => {
  it("never depends on the browser-supplied type", () => {
    expect(SAFE_MIME.text).toBe("text/plain; charset=utf-8");
    expect(SAFE_MIME.pdf).toBe("application/pdf");
    for (const mime of Object.values(SAFE_MIME)) expect(mime).not.toMatch(/html|svg|xml$/);
  });

  it("shows PDFs and text inline but downloads DOCX", () => {
    expect(INLINE_KINDS.has("pdf")).toBe(true);
    expect(INLINE_KINDS.has("text")).toBe(true);
    expect(INLINE_KINDS.has("docx")).toBe(false);
  });

  it("takes the kind from the extension, so an old row with text/html is still served safely", () => {
    expect(detectKind("evil.txt", "")).toBe("text");
    expect(detectKind("evil.html", "")).toBeNull();
    expect(detectKind("noextension", "")).toBeNull();
    expect(detectKind("EVIL.PDF", "")).toBe("pdf");
  });
});

describe("contentDisposition", () => {
  it("passes a simple name through in both forms", () => {
    expect(contentDisposition("syllabus.pdf", "inline")).toBe(`inline; filename="syllabus.pdf"; filename*=UTF-8''syllabus.pdf`);
  });

  it("cannot be broken out of with quotes, semicolons or newlines", () => {
    const header = contentDisposition('a"; filename="evil.html\r\nX-Injected: 1', "attachment");
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.split(";").length).toBe(3); // disposition; filename=...; filename*=...
    expect(header.match(/"/g)?.length).toBe(2);
  });

  it("keeps non-Latin names readable in the UTF-8 form and safe in the ASCII fallback", () => {
    const header = contentDisposition("गणित नोट्स (v2).pdf", "inline");
    expect(header).toMatch(/filename\*=UTF-8''%E0%A4%97/);
    expect(header).toMatch(/filename="[\x20-\x7e]*"/);
    expect(header).toContain("%28v2%29"); // parentheses are escaped in the extended form
  });

  it("falls back to a placeholder for an empty name", () => {
    expect(contentDisposition("", "inline")).toContain('filename="file"');
  });
});
