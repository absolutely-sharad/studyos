import { db } from "@/lib/db";
import { LEVEL_FACTOR } from "@/lib/config";
import { addDays, fromDateKey, toDateKey, weekday, type DateKey } from "@/lib/dates";
import { weeklyMinutesOf } from "@/lib/exam-utils";
import { isWeak, masteryFromProgress } from "@/lib/mastery";

/** Loads a task only if it belongs to the user. */
export function findOwnedTask(userId: string, taskId: string) {
  return db.studyTask.findFirst({ where: { id: taskId, exam: { userId } }, include: { exam: true } });
}

/** Recomputes a topic's mastery and status from its completed sessions. */
export async function refreshTopicMastery(topicId: string) {
  const topic = await db.topic.findUnique({ where: { id: topicId }, include: { subject: { select: { level: true } } } });
  if (!topic) return { weak: false };
  const done = await db.studyTask.findMany({
    where: { topicId, status: "COMPLETED" },
    orderBy: { completedAt: "asc" },
    select: { type: true, minutes: true, rating: true },
  });
  const required = Math.round(topic.estimatedMinutes * LEVEL_FACTOR[topic.subject.level]);
  const studied = done.filter((t) => t.type === "LEARN" || t.type === "PRACTICE").reduce((s, t) => s + t.minutes, 0);
  const ratings = done.map((t) => t.rating).filter((r): r is number => r !== null);
  const weak = isWeak(ratings);
  const wasDone = topic.status === "COMPLETED" && studied === 0;
  const mastery = wasDone ? topic.mastery : masteryFromProgress(required, studied, ratings);
  const status = weak
    ? "NEEDS_REVISION"
    : studied >= required || wasDone
      ? "COMPLETED"
      : studied > 0
        ? "IN_PROGRESS"
        : "NOT_STARTED";
  await db.topic.update({ where: { id: topicId }, data: { mastery, status } });
  return { weak };
}

/** Adds a short revision on one of the next few days that still has room within the daily limit. */
export async function addSupportRevision(
  exam: { id: string; examDate: Date; weeklyMinutes: unknown; unavailableDates: string[] },
  topic: { id: string; name: string },
  today: DateKey,
): Promise<DateKey | null> {
  const plan = await db.studyPlan.findFirst({ where: { examId: exam.id, isActive: true } });
  if (!plan) return null;
  const weekly = weeklyMinutesOf(exam);
  const examDate = toDateKey(exam.examDate);
  for (let i = 1; i <= 3; i++) {
    const date = addDays(today, i);
    if (date >= examDate) break;
    if (exam.unavailableDates.includes(date)) continue;
    const dayTasks = await db.studyTask.findMany({
      where: { examId: exam.id, date: fromDateKey(date), status: { notIn: ["SKIPPED", "MISSED"] } },
      select: { minutes: true },
    });
    const used = dayTasks.reduce((s, t) => s + t.minutes, 0);
    if (used + 20 > (weekly[weekday(date)] ?? 0)) continue;
    await db.studyTask.create({
      data: {
        planId: plan.id,
        examId: exam.id,
        topicId: topic.id,
        date: fromDateKey(date),
        order: dayTasks.length,
        type: "REVISION",
        title: `Revise: ${topic.name}`,
        minutes: 20,
        notes: "Added because this topic felt difficult.",
      },
    });
    return date;
  }
  return null;
}
