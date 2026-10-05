import { db } from "@/lib/db";
import { CATEGORY_LABELS } from "@/lib/documents/serialize";

export interface TopicSource {
  documentId: string;
  filename: string;
  category: string;
  categoryLabel: string;
  pages: number[];
  mentions: number;
}

const CATEGORY_RANK: Record<string, number> = {
  NOTES: 0,
  REVISION_NOTES: 1,
  TEXTBOOK: 2,
  PYQ: 3,
  QUESTION_BANK: 4,
  OTHER: 5,
  SYLLABUS: 6,
};

/**
 * Where a topic appears in the student's own materials, with page numbers for citation.
 * Keyword match for v1; vector search (pgvector) replaces this in the RAG phase.
 */
export async function findTopicSources(examId: string, userId: string, names: string[]): Promise<TopicSource[]> {
  const terms = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 3))].slice(0, 5);
  if (terms.length === 0) return [];
  const chunks = await db.documentChunk.findMany({
    where: {
      document: { examId, userId, status: "READY" },
      OR: terms.map((t) => ({ content: { contains: t, mode: "insensitive" as const } })),
    },
    select: { pageNumber: true, document: { select: { id: true, filename: true, category: true } } },
    take: 300,
  });

  const byDoc = new Map<string, TopicSource>();
  for (const c of chunks) {
    const d = c.document;
    const entry =
      byDoc.get(d.id) ??
      { documentId: d.id, filename: d.filename, category: d.category, categoryLabel: CATEGORY_LABELS[d.category] ?? d.category, pages: [], mentions: 0 };
    entry.mentions++;
    if (c.pageNumber !== null && !entry.pages.includes(c.pageNumber)) entry.pages.push(c.pageNumber);
    byDoc.set(d.id, entry);
  }
  return [...byDoc.values()]
    .map((s) => ({ ...s, pages: s.pages.sort((a, b) => a - b) }))
    .sort((a, b) => (CATEGORY_RANK[a.category] ?? 9) - (CATEGORY_RANK[b.category] ?? 9) || b.mentions - a.mentions);
}

export function pageRanges(pages: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    out.push(i === j ? `${pages[i]}` : `${pages[i]}–${pages[j]}`);
    i = j;
  }
  return out.join(", ");
}
