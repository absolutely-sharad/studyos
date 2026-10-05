/** Rating scale from the end-of-session check-in: 1 very difficult … 5 easy. */
export const RATINGS = [
  { value: 1, label: "Very difficult", emoji: "😫" },
  { value: 2, label: "Difficult", emoji: "😕" },
  { value: 3, label: "Okay", emoji: "😐" },
  { value: 4, label: "Good", emoji: "🙂" },
  { value: 5, label: "Easy", emoji: "🔥" },
] as const;

/**
 * Mastery 0–100 from how much of the topic is done (60%) and how it felt (40%).
 * Quiz and PYQ accuracy join this signal in the practice-engine phase.
 */
export function masteryFromProgress(requiredMinutes: number, completedMinutes: number, ratings: number[]): number {
  const progress = requiredMinutes > 0 ? Math.min(1, completedMinutes / requiredMinutes) : 1;
  const feel = ratings.length ? ratings.reduce((s, r) => s + (r - 1) / 4, 0) / ratings.length : 0.5;
  return Math.round(100 * (0.6 * progress + 0.4 * feel * progress));
}

/** Weak when the latest session was very difficult, or the last two were difficult. */
export function isWeak(ratings: number[]): boolean {
  const last = ratings.at(-1);
  if (last === undefined) return false;
  if (last === 1) return true;
  const prev = ratings.at(-2);
  return last <= 2 && prev !== undefined && prev <= 2;
}
