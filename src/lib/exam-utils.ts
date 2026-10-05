export function weeklyMinutesOf(exam: { weeklyMinutes: unknown }): Record<number, number> {
  const raw = (exam.weeklyMinutes ?? {}) as Record<string, number>;
  const out: Record<number, number> = {};
  for (let d = 0; d < 7; d++) out[d] = Math.max(0, Number(raw[String(d)] ?? 0));
  return out;
}
