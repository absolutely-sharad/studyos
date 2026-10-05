import { cleanTopicName, dedupeDraft } from "./normalize";
import type { DraftSubject, DraftTopic, SyllabusDraft } from "./types";

const SUBJECT_RE = /^(?:subject|section|paper|part|course)\s*[\w.]{0,4}\s*[:.\-–—)]\s*(.{2,80})$/i;
const UNIT_RE = /^(?:unit|module|chapter|week|block)\s*[-–—]?\s*([ivxlcdm\d]{1,5})\b\s*[:.\-–—)]?\s*(.*)$/i;
const BULLET_RE = /^(?:[-•*●▪◦‣]|\(?[a-h]\)|\d+(?:\.\d+)*[.)]?)\s+(.*)$/i;
const LABEL_RE = /^([^:,]{3,60}):\s*(.+)$/;
const SKIP_SECTION_RE = /^(text\s*books?|reference(s| books?)?|suggested readings?|course outcomes?|course objectives?|learning outcomes?|evaluation|assessment|marks distribution|lab(oratory)? (work|experiments))\b/i;
const NOISE_RE = /^(page\s*\d+|\d+|syllabus|contents?|l\s*t\s*p\s*c?.*|credits?.*)$/i;

function isAllCaps(line: string) {
  const letters = line.replace(/[^A-Za-z]/g, "");
  return letters.length >= 4 && letters === letters.toUpperCase() && line.split(/\s+/).length <= 8 && !line.includes(",");
}

function splitItems(text: string): string[] {
  return text
    .split(/[;,]|\.\s+|\s+[–—]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Joins hyphenated and wrapped lines produced by PDF extraction. */
function unwrap(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim());
  const out: string[] = [];
  for (const line of raw) {
    const prev = out.at(-1);
    if (prev && line && prev.endsWith("-") && /^[a-z]/.test(line)) {
      out[out.length - 1] = prev.slice(0, -1) + line;
    } else if (prev && line && /^[a-z(]/.test(line) && !UNIT_RE.test(prev) && !SUBJECT_RE.test(prev)) {
      out[out.length - 1] = `${prev} ${line}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Rule-based syllabus parser — works with no AI key and as a fallback. */
export function parseSyllabusText(text: string, fallbackSubject: string): SyllabusDraft {
  const subjects: DraftSubject[] = [];
  let subject: DraftSubject | null = null;
  let chapter: string | null = null;
  let skipping = false;

  const ensureSubject = () => {
    if (!subject) {
      subject = { name: fallbackSubject, topics: [] };
      subjects.push(subject);
    }
    return subject;
  };
  const addTopic = (raw: string) => {
    const name = cleanTopicName(raw);
    if (!name) return;
    const t: DraftTopic = {
      name,
      chapter,
      aliases: [],
      difficulty: 3,
      importance: 3,
      estimatedMinutes: 90,
      prerequisites: [],
      confidence: 0.6,
    };
    ensureSubject().topics.push(t);
  };

  for (const line of unwrap(text)) {
    if (!line || line.length < 3 || NOISE_RE.test(line)) continue;
    if (/\bsyllabus\b/i.test(line) && line.length < 100) continue; // document title

    const subjectMatch = line.match(SUBJECT_RE);
    if (subjectMatch) {
      subject = { name: cleanTopicName(subjectMatch[1]) ?? subjectMatch[1].trim(), topics: [] };
      subjects.push(subject);
      chapter = null;
      skipping = false;
      continue;
    }

    const unitMatch = line.match(UNIT_RE);
    if (unitMatch) {
      skipping = false;
      const rest = unitMatch[2].trim();
      const label = rest.match(LABEL_RE);
      if (label) {
        chapter = cleanTopicName(label[1]) ?? `Unit ${unitMatch[1]}`;
        splitItems(label[2]).forEach(addTopic);
      } else if (rest && splitItems(rest).length >= 3) {
        chapter = `Unit ${unitMatch[1].toUpperCase()}`;
        splitItems(rest).forEach(addTopic);
      } else {
        chapter = cleanTopicName(rest) ?? `Unit ${unitMatch[1].toUpperCase()}`;
      }
      continue;
    }

    if (SKIP_SECTION_RE.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping) continue;

    if (isAllCaps(line) && !BULLET_RE.test(line)) {
      subject = { name: cleanTopicName(line.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())) ?? line, topics: [] };
      subjects.push(subject);
      chapter = null;
      continue;
    }

    const bullet = line.match(BULLET_RE);
    const body = bullet ? bullet[1] : line;
    const label = body.match(LABEL_RE);
    if (label && splitItems(label[2]).length >= 1) {
      chapter = cleanTopicName(label[1]) ?? chapter;
      splitItems(label[2]).forEach(addTopic);
    } else if (body.endsWith(":")) {
      chapter = cleanTopicName(body) ?? chapter;
    } else {
      splitItems(body).forEach(addTopic);
    }
  }

  return { subjects: dedupeDraft(subjects), source: "parser" };
}
