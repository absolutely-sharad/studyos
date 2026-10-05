import { transitiveDependents } from "./graph";

export interface PriorityTopic {
  id: string;
  name: string;
  /** 1–5 */
  importance: number;
  /** 1–5 */
  difficulty: number;
  /** 0–100 */
  mastery: number;
  pyqFrequency: number;
  prerequisites: string[];
}

export interface PriorityWeights {
  importance: number;
  pyq: number;
  centrality: number;
  weakness: number;
  difficulty: number;
}

/** Configurable — tune per exam type later. */
export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  importance: 0.25,
  pyq: 0.25,
  centrality: 0.2,
  weakness: 0.2,
  difficulty: 0.1,
};

export interface PriorityResult {
  score: number;
  level: "High" | "Medium" | "Low";
  reasons: string[];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function computePriorities(
  topics: PriorityTopic[],
  weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS,
): Map<string, PriorityResult> {
  const dependents = transitiveDependents(topics.map((t) => ({ id: t.id, priority: 0, prerequisites: t.prerequisites })));
  const maxPyq = Math.max(0, ...topics.map((t) => t.pyqFrequency));
  const maxDeps = Math.max(0, ...topics.map((t) => dependents.get(t.id)?.size ?? 0));

  // Signals with no data (e.g. no PYQs uploaded) are left out instead of counting as zero.
  const active: (keyof PriorityWeights)[] = ["importance", "weakness", "difficulty"];
  if (maxPyq > 0) active.push("pyq");
  if (maxDeps > 0) active.push("centrality");
  const totalWeight = active.reduce((s, k) => s + weights[k], 0) || 1;

  const out = new Map<string, PriorityResult>();
  for (const t of topics) {
    const deps = dependents.get(t.id)?.size ?? 0;
    const signals: Record<keyof PriorityWeights, number> = {
      importance: clamp01((t.importance - 1) / 4),
      pyq: maxPyq > 0 ? t.pyqFrequency / maxPyq : 0,
      centrality: maxDeps > 0 ? deps / maxDeps : 0,
      weakness: clamp01(1 - t.mastery / 100),
      difficulty: clamp01((t.difficulty - 1) / 4),
    };
    const raw = active.reduce((s, k) => s + weights[k] * signals[k], 0) / totalWeight;
    const score = Math.round(raw * 100);

    const reasons: string[] = [];
    if (maxPyq > 0 && t.pyqFrequency > 0 && signals.pyq >= 0.5)
      reasons.push(`it appears in ${t.pyqFrequency} previous-year question${t.pyqFrequency === 1 ? "" : "s"}`);
    if (deps > 0 && signals.centrality >= 0.4) reasons.push(`it is needed for ${deps} other topic${deps === 1 ? "" : "s"}`);
    if (t.importance >= 4) reasons.push("it is marked as important in your syllabus");
    if (t.mastery < 40) reasons.push(`your mastery is low (${t.mastery}%)`);
    if (t.difficulty >= 4) reasons.push("it is one of the harder topics");

    out.set(t.id, { score, level: score >= 65 ? "High" : score >= 40 ? "Medium" : "Low", reasons });
  }
  return out;
}

export function explainPriority(level: string, reasons: string[]): string {
  if (reasons.length === 0) return `${level} priority based on your syllabus and progress.`;
  const list = reasons.length === 1 ? reasons[0] : `${reasons.slice(0, -1).join(", ")} and ${reasons.at(-1)}`;
  return `${level} priority because ${list}.`;
}
