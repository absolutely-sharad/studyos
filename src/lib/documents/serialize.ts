export interface DocumentView {
  id: string;
  filename: string;
  category: string;
  categorySource: string;
  detectedCategory: string | null;
  detectionNote: string | null;
  status: string;
  sizeBytes: number;
  pageCount: number | null;
  error: string | null;
  createdAt: string;
}

export function toDocumentView(d: {
  id: string;
  filename: string;
  category: string;
  categorySource: string;
  detectedCategory: string | null;
  detectionNote: string | null;
  status: string;
  sizeBytes: number;
  pageCount: number | null;
  error: string | null;
  createdAt: Date;
}): DocumentView {
  return {
    id: d.id,
    filename: d.filename,
    category: d.category,
    categorySource: d.categorySource,
    detectedCategory: d.detectedCategory,
    detectionNote: d.detectionNote,
    status: d.status,
    sizeBytes: d.sizeBytes,
    pageCount: d.pageCount,
    error: d.error,
    createdAt: d.createdAt.toISOString(),
  };
}

export const CATEGORY_LABELS: Record<string, string> = {
  SYLLABUS: "Syllabus",
  NOTES: "Notes",
  TEXTBOOK: "Textbook",
  PYQ: "Previous-year paper",
  QUESTION_BANK: "Question bank",
  REVISION_NOTES: "Revision notes",
  OTHER: "Other",
};
