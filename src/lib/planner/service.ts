import { db } from "@/lib/db";
import { LEVEL_FACTOR } from "@/lib/config";
import { diffDays, formatDay, formatMinutes, fromDateKey, toDateKey, type DateKey } from "@/lib/dates";
import { weeklyMinutesOf } from "@/lib/exam-utils";
import { buildPlan } from "./schedule";
import { saveScores, scoreTopics, type ScoredTopic } from "./signals";
import type { PlannerOutput } from "./types";

interface PlanComputation {
  today: DateKey;
  examDate: DateKey;
  output: PlannerOutput;
  scored: ScoredTopic[];
  planId: string | null;
  previousProjected: DateKey | null;
  behindMinutes: number;
  skippedMinutes: number;
  keptPinned: number;
  boosted: string[];
  orderOffset: Record<DateKey, number>;
}

const isStudy = (type: string) => type === "LEARN" || type === "PRACTICE";

async function computePlan(examId: string, today: DateKey): Promise<PlanComputation> {
  const exam = await db.exam.findUniqueOrThrow({ where: { id: examId } });
  const [scored, tasks, plan] = await Promise.all([
    scoreTopics(examId),
    db.studyTask.findMany({
      where: { examId },
      select: { topicId: true, date: true, type: true, minutes: true, status: true, pinned: true, updatedAt: true },
    }),
    db.studyPlan.findFirst({ where: { examId, isActive: true } }),
  ]);

  const completed = new Map<string, number>();
  const pinnedAhead = new Map<string, number>();
  const reserved: Record<DateKey, number> = {};
  const orderOffset: Record<DateKey, number> = {};
  let behindMinutes = 0;
  let skippedMinutes = 0;
  let keptPinned = 0;

  for (const t of tasks) {
    const date = toDateKey(t.date);
    if (t.topicId && isStudy(t.type) && t.status === "COMPLETED")
      completed.set(t.topicId, (completed.get(t.topicId) ?? 0) + t.minutes);
    if (date < today && (t.status === "TODO" || t.status === "IN_PROGRESS")) behindMinutes += t.minutes;
    if (t.status === "SKIPPED" && (!plan || t.updatedAt > plan.updatedAt)) skippedMinutes += t.minutes;
    if (date >= today && (t.pinned || t.status !== "TODO")) {
      if (t.status !== "SKIPPED" && t.status !== "MISSED") reserved[date] = (reserved[date] ?? 0) + t.minutes;
      orderOffset[date] = (orderOffset[date] ?? 0) + 1;
      if (t.pinned && t.status === "TODO") {
        keptPinned++;
        if (t.topicId && isStudy(t.type)) pinnedAhead.set(t.topicId, (pinnedAhead.get(t.topicId) ?? 0) + t.minutes);
      }
    }
  }

  const topics = scored.map((t) => {
    const required = Math.round(t.estimatedMinutes * LEVEL_FACTOR[t.subjectLevel]);
    const remaining =
      t.status === "COMPLETED" ? 0 : Math.max(0, required - (completed.get(t.id) ?? 0) - (pinnedAhead.get(t.id) ?? 0));
    return { id: t.id, name: t.name, remainingMinutes: remaining, totalMinutes: required, priority: t.priority.score, prerequisites: t.prerequisites };
  });
  const boosted = scored.filter((t) => t.status === "NEEDS_REVISION").map((t) => t.id);

  const examDate = toDateKey(exam.examDate);
  const output = buildPlan({
    startDate: today,
    examDate,
    weeklyMinutes: weeklyMinutesOf(exam),
    unavailableDates: exam.unavailableDates,
    bufferPercent: exam.bufferPercent,
    topics,
    reservedMinutes: reserved,
    boostRevisionTopicIds: boosted,
  });

  return {
    today,
    examDate,
    output,
    scored,
    planId: plan?.id ?? null,
    previousProjected: plan?.projectedCompletion ? toDateKey(plan.projectedCompletion) : null,
    behindMinutes,
    skippedMinutes,
    keptPinned,
    boosted: scored.filter((t) => boosted.includes(t.id) && output.tasks.some((x) => x.topicId === t.id)).map((t) => t.name),
    orderOffset,
  };
}

export interface PlanSummary {
  text: string;
  behindMinutes: number;
  previousProjected: DateKey | null;
  projected: DateKey | null;
  marginDays: number | null;
  unscheduledMinutes: number;
  unscheduledTopics: string[];
  warnings: string[];
  taskCount: number;
}

function summarize(c: PlanComputation, mode: "initial" | "replan"): PlanSummary {
  const { output } = c;
  const day = (d: DateKey) => formatDay(d, { day: "numeric", month: "short" });
  const margin = output.projectedCompletion ? diffDays(output.projectedCompletion, c.examDate) : null;
  const parts: string[] = [];

  if (mode === "initial") {
    const topicCount = new Set(output.tasks.map((t) => t.topicId).filter(Boolean)).size;
    parts.push(`Your plan covers ${topicCount} topics across ${output.studyDays} study days, with revision built in.`);
  } else {
    if (c.behindMinutes > 0) parts.push(`You're ${formatMinutes(c.behindMinutes)} behind.`);
    else if (c.skippedMinutes > 0) parts.push(`You skipped ${formatMinutes(c.skippedMinutes)} of study.`);
    parts.push("I rebuilt your plan from today without going over your daily study limit.");
    if (c.keptPinned > 0) parts.push(`Your ${c.keptPinned} pinned task${c.keptPinned === 1 ? " stays" : "s stay"} where you put ${c.keptPinned === 1 ? "it" : "them"}.`);
  }
  if (c.boosted.length > 0) parts.push(`Extra revision added for ${c.boosted.slice(0, 3).join(", ")}.`);

  if (output.projectedCompletion && margin !== null) {
    const when =
      mode === "replan" && c.previousProjected && c.previousProjected !== output.projectedCompletion
        ? `Syllabus completion moves from ${day(c.previousProjected)} to ${day(output.projectedCompletion)}`
        : `Syllabus completion is projected for ${day(output.projectedCompletion)}`;
    parts.push(`${when}, ${margin} day${margin === 1 ? "" : "s"} before your exam.`);
  }
  if (output.unscheduledMinutes > 0) {
    const names = output.unscheduled.slice(0, 3).map((u) => u.name).join(", ");
    parts.push(
      `${formatMinutes(output.unscheduledMinutes)} of lower-priority topics (${names}${output.unscheduled.length > 3 ? "…" : ""}) don't fit. Add study hours in Settings or remove topics you can skip.`,
    );
  }

  return {
    text: parts.join(" "),
    behindMinutes: c.behindMinutes,
    previousProjected: c.previousProjected,
    projected: output.projectedCompletion,
    marginDays: margin,
    unscheduledMinutes: output.unscheduledMinutes,
    unscheduledTopics: output.unscheduled.map((u) => u.name),
    warnings: output.warnings,
    taskCount: output.tasks.length,
  };
}

/** Dry run: what a replan would do. Nothing is saved. */
export async function previewReplan(examId: string, today: DateKey) {
  return summarize(await computePlan(examId, today), "replan");
}

/** Builds or rebuilds the plan from today. Pinned, completed and past tasks are kept. */
export async function applyPlan(examId: string, today: DateKey, mode: "initial" | "replan", reason: string) {
  const c = await computePlan(examId, today);
  const summary = summarize(c, mode);
  const todayDate = fromDateKey(today);
  const planData = {
    projectedCompletion: c.output.projectedCompletion ? fromDateKey(c.output.projectedCompletion) : null,
    finalRevisionStart: c.output.finalRevisionStart ? fromDateKey(c.output.finalRevisionStart) : null,
    unscheduledMinutes: c.output.unscheduledMinutes,
    warnings: c.output.warnings,
  };

  await db.$transaction(
    async (tx) => {
      const plan = c.planId
        ? await tx.studyPlan.update({ where: { id: c.planId }, data: { ...planData, version: { increment: 1 } } })
        : await tx.studyPlan.create({ data: { examId, ...planData } });
      await tx.studyTask.updateMany({
        where: { examId, date: { lt: todayDate }, status: { in: ["TODO", "IN_PROGRESS"] } },
        data: { status: "MISSED" },
      });
      await tx.studyTask.deleteMany({ where: { examId, date: { gte: todayDate }, status: "TODO", pinned: false } });
      if (c.output.tasks.length > 0) {
        await tx.studyTask.createMany({
          data: c.output.tasks.map((t) => ({
            planId: plan.id,
            examId,
            topicId: t.topicId,
            date: fromDateKey(t.date),
            order: t.order + (c.orderOffset[t.date] ?? 0),
            type: t.type,
            title: t.title,
            minutes: t.minutes,
            source: "AI" as const,
          })),
        });
      }
      await tx.planChange.create({
        data: {
          planId: plan.id,
          examId,
          reason,
          summary: summary.text,
          details: JSON.parse(JSON.stringify(summary)),
        },
      });
    },
    { timeout: 30_000 },
  );
  await saveScores(examId, c.scored);
  return summary;
}
