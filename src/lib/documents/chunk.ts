import type { ExtractedPage } from "./extract";

export interface Chunk {
  index: number;
  page: number | null;
  content: string;
  tokenCount: number;
}

/**
 * Paragraph-aware chunks that never cross a page boundary, so every chunk can cite a page.
 * No overlap in v1: joining chunks in order reproduces the document text.
 */
export function chunkPages(pages: ExtractedPage[], maxChars = 1500): Chunk[] {
  const chunks: Chunk[] = [];
  const push = (page: number | null, content: string) => {
    const c = content.trim();
    if (!c) return;
    chunks.push({ index: chunks.length, page, content: c, tokenCount: Math.ceil(c.length / 4) });
  };

  for (const { page, text } of pages) {
    const paragraphs = text.replace(/\r\n/g, "\n").split(/\n\s*\n/);
    let current = "";
    for (const para of paragraphs) {
      const p = para.trim();
      if (!p) continue;
      if (p.length > maxChars) {
        push(page, current);
        current = "";
        for (let i = 0; i < p.length; i += maxChars) push(page, p.slice(i, i + maxChars));
        continue;
      }
      if (current.length + p.length + 2 > maxChars) {
        push(page, current);
        current = p;
      } else {
        current = current ? `${current}\n\n${p}` : p;
      }
    }
    push(page, current);
  }
  return chunks;
}
