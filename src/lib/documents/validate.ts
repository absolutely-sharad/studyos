import type { DocumentKind } from "./extract";

/**
 * What we serve a file back as. Always derived from the detected kind, never from the
 * browser-supplied Content-Type, which an attacker controls (e.g. "text/html").
 */
export const SAFE_MIME: Record<DocumentKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  text: "text/plain; charset=utf-8",
};

/** PDF and plain text are safe to show in the browser; DOCX can't be shown, so it downloads. */
export const INLINE_KINDS: ReadonlySet<DocumentKind> = new Set(["pdf", "text"]);

/**
 * Checks that the bytes really are what the extension claims, so a renamed executable or HTML page
 * is rejected at upload instead of failing later in a parser.
 */
export function matchesKind(data: Uint8Array, kind: DocumentKind): boolean {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (kind === "pdf") {
    // The spec allows up to 1 KB of junk before the header.
    return buf.subarray(0, 1024).includes("%PDF-");
  }
  if (kind === "docx") {
    // A DOCX is a ZIP (starts "PK\x03\x04") whose entries include word/document.xml.
    return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04 && buf.includes("word/document.xml");
  }
  // Text: a NUL byte near the start means binary data.
  return !buf.subarray(0, 8192).includes(0);
}

/**
 * Content-Disposition with an ASCII fallback plus the RFC 5987 UTF-8 form, so names with quotes,
 * semicolons, newlines or non-Latin letters can't break out of the header or arrive garbled.
 */
export function contentDisposition(filename: string, disposition: "inline" | "attachment"): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%;]/g, "_").slice(0, 150) || "file";
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
