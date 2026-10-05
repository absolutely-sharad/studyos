export type DocumentCategoryKey = "SYLLABUS" | "NOTES" | "TEXTBOOK" | "PYQ" | "QUESTION_BANK" | "REVISION_NOTES" | "OTHER";

// Checked in order: the first match wins, so specific kinds come before generic ones.
const RULES: [RegExp, DocumentCategoryKey][] = [
  [/syllab|curricul|course outline|scheme of (study|exam)|exam pattern/, "SYLLABUS"],
  [/question bank|\bqb\b|\bmcqs?\b|practice (set|questions?)|worksheet|assignment/, "QUESTION_BANK"],
  [
    /\bpyqs?\b|previous years?|past (years?|papers?)|question papers?|\bqp\b|solved papers?|(paper|exam) (19|20)\d{2}|(19|20)\d{2} (paper|exam|qp)|mid ?sem|end ?sem|\b(gate|jee|cat|upsc|neet) (19|20)\d{2}/,
    "PYQ",
  ],
  [/revision|cheat ?sheet|formula|short notes|summary|quick ref/, "REVISION_NOTES"],
  [/text ?book|\bbook\b|edition|\b\d+(st|nd|rd|th) ed\b/, "TEXTBOOK"],
  [/\bnotes?\b|lecture|class|handout|slides?|\bppt\b|\bunit \d|chapter|module/, "NOTES"],
];

/** Category implied by the file name, or null when the name says nothing ("IMG_2041.pdf"). */
export function categoryFromName(filename: string): DocumentCategoryKey | null {
  const name = normalizeName(filename);
  for (const [re, category] of RULES) if (re.test(name)) return category;
  if (/\b(19|20)\d{2}\b/.test(name)) return "PYQ"; // "2023.pdf", "CSE 2019.pdf"
  return null;
}

/** Best guess at a document's category from its file name. Students can change it afterwards. */
export function guessCategory(filename: string): DocumentCategoryKey {
  return categoryFromName(filename) ?? "NOTES";
}

function normalizeName(filename: string) {
  return filename
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.()+[\],]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
