import { topicKey } from "@/lib/syllabus/normalize";

/** Splits PYQ text into individual questions (Q1 / 1. / 1) …), falling back to paragraphs. */
export function splitQuestions(text: string): string[] {
  const parts = text.split(/\n\s*(?=(?:Q(?:uestion)?\s*\.?\s*\d+[.):]?|\d{1,3}[.)])\s)/i).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) return parts;
  return text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
}

/** Number of questions that mention a topic by name or alias (stem-tolerant). */
export function countMentions(questionKeys: string[], names: string[]): number {
  const terms = [...new Set(names.map(topicKey).filter((k) => k.length >= 3))];
  if (terms.length === 0) return 0;
  return questionKeys.filter((q) => terms.some((t) => q.includes(` ${t} `))).length;
}

export function questionKeys(texts: string[]): string[] {
  return texts.flatMap(splitQuestions).map((q) => ` ${topicKey(q)} `);
}
