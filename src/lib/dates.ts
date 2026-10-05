// Calendar dates are handled as "YYYY-MM-DD" keys and stored as UTC-midnight DATE values.

export type DateKey = string;

export function toDateKey(d: Date): DateKey {
  return d.toISOString().slice(0, 10);
}

export function fromDateKey(key: DateKey): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function addDays(key: DateKey, days: number): DateKey {
  const d = fromDateKey(key);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateKey(d);
}

export function diffDays(from: DateKey, to: DateKey): number {
  return Math.round((fromDateKey(to).getTime() - fromDateKey(from).getTime()) / 86_400_000);
}

export function weekday(key: DateKey): number {
  return fromDateKey(key).getUTCDay();
}

/** Today's date in the student's timezone. */
export function todayKey(timeZone = "Asia/Kolkata", now = new Date()): DateKey {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function formatDay(key: DateKey, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "short" }) {
  return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "UTC" }).format(fromDateKey(key));
}

export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

/** Monday-start week key for grouping. */
export function weekStart(key: DateKey): DateKey {
  const wd = weekday(key);
  return addDays(key, wd === 0 ? -6 : 1 - wd);
}
