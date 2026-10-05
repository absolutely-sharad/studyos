import { addDays, diffDays, weekday, type DateKey } from "@/lib/dates";

export interface HealthTask {
  date: DateKey;
  type: "LEARN" | "PRACTICE" | "REVISION" | "MOCK";
  minutes: number;
  status: "TODO" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | "MISSED";
}

export interface HealthInput {
  today: DateKey;
  examDate: DateKey;
  finalRevisionStart: DateKey | null;
  weeklyMinutes: Record<number, number>;
  unavailableDates: DateKey[];
  bufferPercent: number;
  unscheduledMinutes: number;
  tasks: HealthTask[];
}

export interface PlanHealth {
  score: number;
  label: "Excellent" | "Good" | "Needs attention" | "At risk";
  tone: "good" | "warn" | "risk";
  factors: { label: string; value: number }[];
  /** Past tasks still open (todo or in progress). Skipped work is picked up on the next replan. */
  behindMinutes: number;
  remainingStudyMinutes: number;
  prediction: {
    date: DateKey;
    marginDays: number;
    basis: "recent pace" | "planned schedule";
    eatsIntoRevision: boolean;
  } | null;
}

const isStudy = (t: HealthTask) => t.type === "LEARN" || t.type === "PRACTICE";
const ratio = (num: number, den: number) => (den <= 0 ? 1 : Math.min(1, num / den));

export function computeHealth(input: HealthInput): PlanHealth {
  const { today, tasks } = input;
  const past = tasks.filter((t) => t.date < today);
  const unavailable = new Set(input.unavailableDates);
  const capacityOn = (d: DateKey) =>
    unavailable.has(d) ? 0 : Math.floor((input.weeklyMinutes[weekday(d)] ?? 0) * (1 - input.bufferPercent / 100));

  // Completion: share of past planned minutes that got done.
  const dueMinutes = past.reduce((s, t) => s + t.minutes, 0);
  const doneMinutes = past.filter((t) => t.status === "COMPLETED").reduce((s, t) => s + t.minutes, 0);
  const completion = ratio(doneMinutes, dueMinutes);

  // Pace: can the remaining study work fit before the revision window?
  const remainingStudyMinutes =
    tasks.filter((t) => isStudy(t) && (t.status === "TODO" || t.status === "IN_PROGRESS"))
      .reduce((s, t) => s + t.minutes, 0) + input.unscheduledMinutes;
  const studyEnd = input.finalRevisionStart ?? input.examDate;
  let capacityAhead = 0;
  for (let d = today; d < studyEnd; d = addDays(d, 1)) capacityAhead += capacityOn(d);
  const pace = remainingStudyMinutes === 0 ? 1 : Math.min(1, capacityAhead / remainingStudyMinutes);

  // Consistency: of the last 7 days that had tasks, how many saw any completed work.
  const lastWeek = past.filter((t) => t.date >= addDays(today, -7));
  const plannedDays = new Set(lastWeek.map((t) => t.date));
  const activeDays = new Set(lastWeek.filter((t) => t.status === "COMPLETED").map((t) => t.date));
  const consistency = ratio(activeDays.size, plannedDays.size);

  // Revision: share of due revision sessions completed.
  const dueRevisions = past.filter((t) => t.type === "REVISION");
  const revision = ratio(dueRevisions.filter((t) => t.status === "COMPLETED").length, dueRevisions.length);

  const score = Math.round(100 * (0.35 * completion + 0.3 * pace + 0.2 * consistency + 0.15 * revision));
  const label = score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 50 ? "Needs attention" : "At risk";
  const tone = score >= 70 ? "good" : score >= 50 ? "warn" : "risk";

  const behindMinutes = past
    .filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS")
    .reduce((s, t) => s + t.minutes, 0);

  // On-track prediction from recent pace, or the planned schedule when there's little history.
  const firstDate = tasks.reduce<DateKey | null>((min, t) => (min === null || t.date < min ? t.date : min), null);
  const historyDays = firstDate ? Math.min(14, Math.max(0, diffDays(firstDate, today))) : 0;
  let prediction: PlanHealth["prediction"] = null;
  if (remainingStudyMinutes === 0) {
    prediction = { date: today, marginDays: diffDays(today, input.examDate), basis: "planned schedule", eatsIntoRevision: false };
  } else {
    let perDay = 0;
    let basis: "recent pace" | "planned schedule" = "planned schedule";
    if (historyDays >= 3) {
      const from = addDays(today, -historyDays);
      const recent = tasks.filter((t) => isStudy(t) && t.status === "COMPLETED" && t.date >= from && t.date < today);
      perDay = recent.reduce((s, t) => s + t.minutes, 0) / historyDays;
      basis = "recent pace";
    }
    if (perDay <= 0) {
      const span = Math.max(1, diffDays(today, studyEnd));
      perDay = capacityAhead / span;
      basis = historyDays >= 3 ? "recent pace" : "planned schedule";
    }
    if (perDay > 0) {
      const date = addDays(today, Math.ceil(remainingStudyMinutes / perDay));
      prediction = {
        date,
        marginDays: diffDays(date, input.examDate),
        basis,
        eatsIntoRevision: input.finalRevisionStart !== null && date > input.finalRevisionStart,
      };
    }
  }

  return {
    score,
    label,
    tone,
    factors: [
      { label: "Tasks completed", value: completion },
      { label: "Pace vs time left", value: pace },
      { label: "Consistency (7 days)", value: consistency },
      { label: "Revision kept up", value: revision },
    ],
    behindMinutes,
    remainingStudyMinutes,
    prediction,
  };
}
