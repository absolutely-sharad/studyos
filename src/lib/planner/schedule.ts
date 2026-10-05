import { addDays, weekday, type DateKey } from "@/lib/dates";
import { prioritizedOrder } from "./graph";
import type { PlannedTask, PlannedTaskType, PlannerInput, PlannerOptions, PlannerOutput, PlannerTopic } from "./types";

export const DEFAULT_PLANNER_OPTIONS: PlannerOptions = {
  maxSessionMinutes: 90,
  minSessionMinutes: 25,
  maxTopicMinutesPerDay: 120,
  practiceShare: 0.25,
  revisionOffsets: [1, 7, 21],
  maxRevisionShare: 0.4,
  consolidationShare: 0.75,
  mockEveryDays: 7,
};

const round5 = (n: number) => Math.round(n / 5) * 5;
const floor5 = (n: number) => Math.floor(n / 5) * 5;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

interface Work {
  topic: PlannerTopic;
  learnLeft: number;
  practiceLeft: number;
  finished: boolean;
}

interface PendingRevision {
  topicId: string;
  name: string;
  due: DateKey;
  minutes: number;
  priority: number;
}

/**
 * Deterministic planner. Same input → same plan.
 * Hard constraints (never violated): exam date, daily capacity, unavailable days, prerequisites.
 * Work that does not fit is reported as unscheduled — never crammed.
 */
export function buildPlan(input: PlannerInput): PlannerOutput {
  const o = { ...DEFAULT_PLANNER_OPTIONS, ...input.options };
  const warnings: string[] = [];
  const unavailable = new Set(input.unavailableDates);
  const reserved = input.reservedMinutes ?? {};
  const buffer = clamp(input.bufferPercent, 0, 50) / 100;

  // 1. Study days and their usable capacity.
  const days: { date: DateKey; capacity: number }[] = [];
  for (let d = input.startDate; d < input.examDate; d = addDays(d, 1)) {
    if (unavailable.has(d)) continue;
    const full = input.weeklyMinutes[weekday(d)] ?? 0;
    const capacity = floor5(full * (1 - buffer) - (reserved[d] ?? 0));
    if (capacity >= 15) days.push({ date: d, capacity });
  }

  const tasks: PlannedTask[] = [];
  const emit = (date: DateKey, type: PlannedTaskType, topic: PlannerTopic | null, minutes: number, title?: string) => {
    const last = tasks.at(-1);
    if (last && last.date === date && last.type === type && last.topicId === (topic?.id ?? null)) {
      last.minutes += minutes;
      return;
    }
    const order = tasks.filter((t) => t.date === date).length;
    const label =
      title ??
      ({ LEARN: "Study", PRACTICE: "Practice", REVISION: "Revise", MOCK: "Mock test" } as const)[type] +
        (topic ? `: ${topic.name}` : "");
    tasks.push({ date, order, type, topicId: topic?.id ?? null, title: label, minutes });
  };

  // 2. Protect a final revision window before the exam.
  const n = days.length;
  const finalCount = n >= 10 ? clamp(Math.round(n * 0.12), 1, 14) : n >= 4 ? 1 : 0;
  const learningDays = days.slice(0, n - finalCount);
  const finalDays = days.slice(n - finalCount);
  const finalRevisionStart = finalDays[0]?.date ?? null;

  // 3. Order topics: prerequisites first, urgency-aware.
  const { order, brokenCycles } = prioritizedOrder(input.topics);
  const byId = new Map(input.topics.map((t) => [t.id, t]));
  if (brokenCycles.length > 0) {
    const names = brokenCycles.map((id) => byId.get(id)?.name).join(", ");
    warnings.push(`Some prerequisites form a loop (${names}). Those topics were ordered by priority instead.`);
  }

  const queue: Work[] = [];
  const workById = new Map<string, Work>();
  for (const id of order) {
    const topic = byId.get(id)!;
    const total = round5(topic.remainingMinutes);
    if (total <= 0) continue;
    const practice = total >= 60 ? round5(total * o.practiceShare) : 0;
    const w: Work = { topic, learnLeft: total - practice, practiceLeft: practice, finished: false };
    queue.push(w);
    workById.set(id, w);
  }
  const prerequisitesDone = (w: Work) =>
    w.topic.prerequisites.every((p) => !workById.has(p) || workById.get(p)!.finished);

  const pendingRevisions: PendingRevision[] = [];
  const revisionMinutes = (t: PlannerTopic) => clamp(round5(t.totalMinutes * 0.15), 15, 30);
  for (const id of input.boostRevisionTopicIds ?? []) {
    const t = byId.get(id);
    if (!t || workById.has(id)) continue; // still being learned — practice covers it
    pendingRevisions.push({ topicId: t.id, name: t.name, due: input.startDate, minutes: 30, priority: 100 });
  }

  // Consolidation pool: once everything is learned, spare days rotate through revision by priority.
  const consolidationPool = [...input.topics].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  let consolidationPointer = 0;
  let daysSinceMock = Number.POSITIVE_INFINITY;

  // 4. Fill learning days: due revisions first, then learning/practice, then consolidation.
  for (const day of learningDays) {
    let cap = day.capacity;

    const revisionBudget = floor5(day.capacity * o.maxRevisionShare);
    let revisionUsed = 0;
    const due = pendingRevisions
      .filter((r) => r.due <= day.date)
      .sort((a, b) => a.due.localeCompare(b.due) || b.priority - a.priority);
    for (const r of due) {
      if (r.minutes > cap || revisionUsed + r.minutes > revisionBudget) continue; // stays pending
      emit(day.date, "REVISION", byId.get(r.topicId)!, r.minutes);
      cap -= r.minutes;
      revisionUsed += r.minutes;
      pendingRevisions.splice(pendingRevisions.indexOf(r), 1);
    }

    const usedToday = new Map<string, number>();
    const blocked = new Set<string>();
    while (cap > 0) {
      const w = queue.find((x) => !x.finished && !blocked.has(x.topic.id) && prerequisitesDone(x));
      if (!w) break;
      const isLearn = w.learnLeft > 0;
      const left = isLearn ? w.learnLeft : w.practiceLeft;
      const room = o.maxTopicMinutesPerDay - (usedToday.get(w.topic.id) ?? 0);
      const a = Math.min(left, cap, o.maxSessionMinutes, room);

      if (a <= 0 || (a < o.minSessionMinutes && a < left)) {
        if (room <= cap) {
          blocked.add(w.topic.id); // topic hit today's limit — try another one
          continue;
        }
        break; // not enough time left today for a useful session
      }

      emit(day.date, isLearn ? "LEARN" : "PRACTICE", w.topic, a);
      cap -= a;
      usedToday.set(w.topic.id, (usedToday.get(w.topic.id) ?? 0) + a);
      if (isLearn) w.learnLeft -= a;
      else w.practiceLeft -= a;

      if (w.learnLeft === 0 && w.practiceLeft === 0) {
        w.finished = true;
        for (const offset of o.revisionOffsets) {
          const dueDate = addDays(day.date, offset);
          if (dueDate >= input.examDate || (finalRevisionStart && dueDate >= finalRevisionStart)) continue;
          pendingRevisions.push({
            topicId: w.topic.id,
            name: w.topic.name,
            due: dueDate,
            minutes: revisionMinutes(w.topic),
            priority: w.topic.priority,
          });
        }
      }
    }

    // Consolidation phase: syllabus is learned but the final window hasn't started.
    // Uses part of the day (not all of it) for revision rounds and a weekly mock.
    if (queue.every((w) => w.finished) && consolidationPool.length > 0) {
      daysSinceMock++;
      let budget = Math.min(cap, floor5(day.capacity * o.consolidationShare) - (day.capacity - cap));
      if (cap >= 120 && daysSinceMock >= o.mockEveryDays) {
        // Mock days use the whole day: the paper plus reviewing mistakes.
        const m = Math.min(180, floor5(cap * 0.8));
        emit(day.date, "MOCK", null, m, "Full mock test + review mistakes");
        cap -= m;
        budget = Math.min(cap, 30);
        daysSinceMock = 0;
      }
      const seen = new Set<string>();
      while (budget >= 20 && seen.size < consolidationPool.length) {
        const t = consolidationPool[consolidationPointer % consolidationPool.length];
        consolidationPointer++;
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        const m = Math.min(budget, t.priority >= 65 ? 45 : 30);
        emit(day.date, "REVISION", t, m);
        cap -= m;
        budget -= m;
      }
    }
  }

  const unfinished = queue.filter((w) => !w.finished);
  const unscheduled = unfinished.map((w) => ({
    topicId: w.topic.id,
    name: w.topic.name,
    minutes: w.learnLeft + w.practiceLeft,
  }));
  const unscheduledMinutes = unscheduled.reduce((s, u) => s + u.minutes, 0);
  const unscheduledIds = new Set(unscheduled.map((u) => u.topicId));

  // 5. Final window: mock tests on alternate days, then priority-ordered revision.
  const pool = [...input.topics]
    .filter((t) => !unscheduledIds.has(t.id))
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  let pointer = 0;
  finalDays.forEach((day, i) => {
    let cap = day.capacity;
    if (i % 2 === 0 && cap >= 150) {
      const m = Math.min(180, floor5(cap * 0.6));
      emit(day.date, "MOCK", null, m, "Full mock test + review mistakes");
      cap -= m;
    }
    for (let k = 0; k < pool.length && cap >= 15; k++) {
      const t = pool[pointer % pool.length];
      const m = Math.min(cap, t.priority >= 65 ? 45 : 30);
      emit(day.date, "REVISION", t, m);
      cap -= m;
      pointer++;
    }
  });

  if (days.length === 0) {
    warnings.push("There are no study days left before the exam with your current availability.");
  } else if (unscheduledMinutes > 0) {
    warnings.push(
      `${Math.round(unscheduledMinutes / 60)}h of study across ${unscheduled.length} lower-priority topic${
        unscheduled.length === 1 ? "" : "s"
      } doesn't fit before your final revision days.`,
    );
  }

  const studyWork = tasks.filter((t) => t.type === "LEARN" || t.type === "PRACTICE");
  return {
    tasks,
    unscheduled,
    unscheduledMinutes,
    projectedCompletion: studyWork.at(-1)?.date ?? null,
    finalRevisionStart,
    studyDays: days.length,
    warnings,
  };
}
