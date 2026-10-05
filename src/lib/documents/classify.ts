import { categoryFromName, type DocumentCategoryKey } from "./categorize";

export interface Classification {
  category: DocumentCategoryKey;
  /** 0–1: how clearly the winner beats the runner-up. */
  confidence: number;
  confident: boolean;
  /** Plain-language evidence for the winning category. */
  reasons: string[];
}

type Signal = { category: DocumentCategoryKey; weight: number; reason: string; test: (t: Text) => boolean };
type Text = { body: string; lines: string[]; pages: number };

const count = (body: string, re: RegExp) => (body.match(re) ?? []).length;

// Weighted evidence. Each signal is cheap, explainable and checked against the first ~20 pages.
const SIGNALS: Signal[] = [
  // Previous-year papers: exam headers, marks, time limits, instructions
  { category: "PYQ", weight: 3, reason: "shows maximum marks", test: (t) => /(maximum|max\.?|total|full) marks/.test(t.body) },
  { category: "PYQ", weight: 2, reason: "states a time limit", test: (t) => /time( allowed)?\s*[:\-]?\s*\d+(\.\d+)?\s*(hours?|hrs?|minutes|mins)/.test(t.body) },
  {
    category: "PYQ",
    weight: 2.5,
    reason: "has exam instructions",
    test: (t) => /attempt (any|all)|answer (any|all)|all questions are compulsory|instructions to (the )?candidates|question paper contains/.test(t.body),
  },
  { category: "PYQ", weight: 1.5, reason: "asks for a roll number", test: (t) => /roll\s*(no|number)/.test(t.body) },
  { category: "PYQ", weight: 2, reason: "marks are shown next to questions", test: (t) => count(t.body, /[[(]\s*\d+(\.\d+)?\s*marks?\s*[\])]|\b\d+\s*marks?\b/g) >= 4 },
  {
    category: "PYQ",
    weight: 1.5,
    reason: "names an exam session and year",
    test: (t) => /(examination|exam|paper|session|semester)[^\n]{0,40}\b(19|20)\d{2}\b|\b(19|20)\d{2}\b[^\n]{0,40}(examination|exam)/.test(t.body),
  },
  { category: "PYQ", weight: 1, reason: "is split into sections", test: (t) => /\b(section|part)[\s-]+(a|b|c|i|ii)\b/.test(t.body) },
  { category: "PYQ", weight: -2, reason: "", test: (t) => t.pages > 25 },

  // Syllabus: units, outcomes, credits, reading lists
  { category: "SYLLABUS", weight: 2.5, reason: "calls itself a syllabus", test: (t) => /\bsyllabus\b|curriculum|scheme of (study|examination)/.test(t.body) },
  { category: "SYLLABUS", weight: 2, reason: "lists course outcomes", test: (t) => /course (outcomes?|objectives)|learning outcomes|\bco\s?\d\b/.test(t.body) },
  { category: "SYLLABUS", weight: 1.5, reason: "mentions credits or contact hours", test: (t) => /\bcredits?\b|\bl\s*[-–]?\s*t\s*[-–]?\s*p\b|contact hours|lecture hours/.test(t.body) },
  {
    category: "SYLLABUS",
    weight: 2.5,
    reason: "lists units or modules",
    test: (t) => t.lines.filter((l) => /^(unit|module|section)\s*[-–:]?\s*([ivx]+|\d+)\b/.test(l)).length >= 3,
  },
  { category: "SYLLABUS", weight: 1, reason: "has a reading list", test: (t) => /text ?books?\s*:|reference books?|suggested readings?/.test(t.body) },
  { category: "SYLLABUS", weight: 1, reason: "", test: (t) => t.pages <= 6 },
  { category: "SYLLABUS", weight: -2.5, reason: "", test: (t) => t.pages > 20 },

  // Question banks: many questions, no exam header
  { category: "QUESTION_BANK", weight: 3, reason: "calls itself a question bank", test: (t) => /question bank|practice (set|questions)|assignment\s*(no|\d)/.test(t.body) },
  { category: "QUESTION_BANK", weight: 2, reason: "has many numbered questions", test: (t) => t.lines.filter((l) => /^(q\.?\s*\d+|\d+[.)])\s+\S/.test(l)).length >= 25 },
  { category: "QUESTION_BANK", weight: 1.5, reason: "has multiple-choice options", test: (t) => t.lines.filter((l) => /^\(?[a-d][.)]\s+\S/.test(l)).length >= 12 },
  { category: "QUESTION_BANK", weight: 0.5, reason: "includes answers", test: (t) => /answer key|answers?\s*:|solutions?\s*:/.test(t.body) },

  // Textbooks: front matter and length
  { category: "TEXTBOOK", weight: 4, reason: "has an ISBN", test: (t) => /\bisbn\b/.test(t.body) },
  { category: "TEXTBOOK", weight: 2, reason: "has a preface or copyright page", test: (t) => /\bpreface\b|\bforeword\b|all rights reserved|copyright\s*(©|\(c\))|\bpublishers?\b/.test(t.body) },
  { category: "TEXTBOOK", weight: 1, reason: "has numbered chapters", test: (t) => count(t.body, /\bchapter\s+\d+/g) >= 3 },
  { category: "TEXTBOOK", weight: 1.5, reason: "has end-of-chapter exercises", test: (t) => count(t.body, /\bexercises?\b/g) >= 2 },
  { category: "TEXTBOOK", weight: 2.5, reason: "is book-length", test: (t) => t.pages >= 80 },
  { category: "TEXTBOOK", weight: 1, reason: "", test: (t) => t.pages >= 40 && t.pages < 80 },

  // Revision notes: short, dense, formula-heavy
  {
    category: "REVISION_NOTES",
    weight: 2.5,
    reason: "is labelled for quick revision",
    test: (t) => /quick revision|revision notes|cheat ?sheet|formula sheet|short notes|key points|last[- ]minute|important formulas/.test(t.body),
  },
  {
    category: "REVISION_NOTES",
    weight: 1.5,
    reason: "is short and mostly bullet points",
    test: (t) => t.pages <= 15 && t.lines.length > 20 && t.lines.filter((l) => /^[•\-*–→▪●]\s*\S/.test(l)).length / t.lines.length > 0.3,
  },

  // Notes: lectures and handouts (also the fallback)
  { category: "NOTES", weight: 1, reason: "", test: () => true },
  { category: "NOTES", weight: 2, reason: "looks like lecture notes", test: (t) => /\blecture\s*(\d+|notes?)\b|class notes|handout|prepared by|course instructor|faculty/.test(t.body) },
  { category: "NOTES", weight: 1, reason: "explains concepts with definitions and examples", test: (t) => count(t.body, /\b(definition|example|for example|e\.g\.)\b/g) >= 4 },
];

const FILENAME_WEIGHT = 2;
const MIN_SCORE = 3;
const MIN_MARGIN = 1.5;

/**
 * What kind of study material a document is, from its text (and file name as one more clue).
 * Deterministic and explainable; runs on every upload after text extraction.
 */
export function classifyDocument(input: { text: string; pageCount: number; filename: string }): Classification {
  const head = input.text.slice(0, 40_000).toLowerCase();
  const t: Text = {
    body: head,
    lines: head.split(/\n+/).map((l) => l.trim()).filter(Boolean),
    pages: input.pageCount,
  };

  const scores = new Map<DocumentCategoryKey, { score: number; reasons: string[] }>();
  const add = (c: DocumentCategoryKey, w: number, reason: string) => {
    const s = scores.get(c) ?? { score: 0, reasons: [] };
    s.score += w;
    if (reason && w > 0) s.reasons.push(reason);
    scores.set(c, s);
  };
  for (const sig of SIGNALS) if (sig.test(t)) add(sig.category, sig.weight, sig.reason);
  const fromName = categoryFromName(input.filename);
  if (fromName) add(fromName, FILENAME_WEIGHT, "its file name says so");

  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const [winner, top] = ranked[0];
  const second = ranked[1]?.[1].score ?? 0;
  const margin = top.score - second;
  return {
    category: winner,
    confidence: Math.max(0, Math.min(1, margin / Math.max(top.score, 1))),
    confident: top.score >= MIN_SCORE && margin >= MIN_MARGIN,
    reasons: top.reasons.slice(0, 3),
  };
}

export function describeReasons(reasons: string[]): string {
  if (reasons.length === 0) return "";
  if (reasons.length === 1) return `It ${reasons[0]}.`;
  return `It ${reasons.slice(0, -1).join(", ")} and ${reasons.at(-1)}.`;
}
