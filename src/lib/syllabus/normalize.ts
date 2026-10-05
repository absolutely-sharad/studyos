import type { DraftSubject } from "./types";

const FILLER = new Set(["algorithm", "algorithms", "concept", "concepts", "basics", "introduction", "intro", "to", "of", "the", "and", "a", "an"]);

function stem(word: string) {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** "Binary Searching" / "binary search algorithm" / "Binary Search" → "binary search" */
export function topicKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .split(" ")
    .filter((w) => w && !FILLER.has(w))
    .map(stem);
  return words.join(" ") || name.toLowerCase().trim();
}

export function cleanTopicName(raw: string): string | null {
  let s = raw
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—•*·,;:.]+|[\s\-–—•*·,;:.]+$/g, "")
    .replace(/^(and|or|etc)\s+/i, "")
    .replace(/\s+(etc)\.?$/i, "")
    .trim();
  if (s.length < 3 || s.length > 90) return null;
  if (/^[\d\s.()ivx-]+$/i.test(s)) return null;
  if (/^(etc|and|or|others?)$/i.test(s)) return null;
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

/** Merges duplicate topics (across all subjects) into the first occurrence, keeping aliases. */
export function dedupeDraft(subjects: DraftSubject[]): DraftSubject[] {
  const seen = new Map<string, { subject: number; topic: number }>();
  const out: DraftSubject[] = subjects.map((s) => ({ name: s.name, topics: [] }));
  subjects.forEach((subject, si) => {
    for (const topic of subject.topics) {
      const key = topicKey(topic.name);
      const hit = seen.get(key);
      if (hit) {
        const existing = out[hit.subject].topics[hit.topic];
        const names = new Set([...existing.aliases, topic.name, ...topic.aliases]);
        names.delete(existing.name);
        existing.aliases = [...names];
        existing.importance = Math.max(existing.importance, topic.importance);
        existing.prerequisites = [...new Set([...existing.prerequisites, ...topic.prerequisites])];
        continue;
      }
      seen.set(key, { subject: si, topic: out[si].topics.length });
      out[si].topics.push({ ...topic, aliases: [...topic.aliases] });
    }
  });
  return out.filter((s) => s.topics.length > 0);
}
