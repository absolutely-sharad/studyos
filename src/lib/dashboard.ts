import { db } from "@/lib/db";
import { addDays, toDateKey, weekStart, type DateKey } from "@/lib/dates";
import { weeklyMinutesOf } from "@/lib/exam-utils";
import { computeHealth } from "@/lib/planner/health";
import { explainPriority } from "@/lib/planner/priority";

export type TaskView = {
  id: string;
  date: DateKey;
  order: number;
  type: "LEARN" | "PRACTICE" | "REVISION" | "MOCK";
  title: string;
  minutes: number;
  status: "TODO" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | "MISSED";
  pinned: boolean;
  source: "AI" | "USER";
  rating: number | null;
  topicId: string | null;
  topicPriority: number | null;
};

export const priorityLevel = (score: number) => (score >= 65 ? "High" : score >= 40 ? "Medium" : "Low");

export async function loadPlanState(exam: { id: string; examDate: Date; weeklyMinutes: unknown; unavailableDates: string[]; bufferPercent: number }, today: DateKey) {
  const [plan, rows] = await Promise.all([
    db.studyPlan.findFirst({ where: { examId: exam.id, isActive: true } }),
    db.studyTask.findMany({
      where: { examId: exam.id },
      orderBy: [{ date: "asc" }, { order: "asc" }],
      include: { topic: { select: { priorityScore: true } } },
    }),
  ]);
  const tasks: TaskView[] = rows.map((t) => ({
    id: t.id,
    date: toDateKey(t.date),
    order: t.order,
    type: t.type,
    title: t.title,
    minutes: t.minutes,
    status: t.status,
    pinned: t.pinned,
    source: t.source,
    rating: t.rating,
    topicId: t.topicId,
    topicPriority: t.topic?.priorityScore ?? null,
  }));
  const health = computeHealth({
    today,
    examDate: toDateKey(exam.examDate),
    finalRevisionStart: plan?.finalRevisionStart ? toDateKey(plan.finalRevisionStart) : null,
    weeklyMinutes: weeklyMinutesOf(exam),
    unavailableDates: exam.unavailableDates,
    bufferPercent: exam.bufferPercent,
    unscheduledMinutes: plan?.unscheduledMinutes ?? 0,
    tasks,
  });
  return { plan, tasks, health };
}

export async function loadDashboard(
  exam: { id: string; examDate: Date; weeklyMinutes: unknown; unavailableDates: string[]; bufferPercent: number },
  today: DateKey,
) {
  const { plan, tasks, health } = await loadPlanState(exam, today);
  const todayTasks = tasks.filter((t) => t.date === today);
  const nextDay = todayTasks.length === 0 ? tasks.find((t) => t.date > today && t.status === "TODO")?.date ?? null : null;

  const ws = weekStart(today);
  const we = addDays(ws, 6);
  const week = tasks.filter((t) => t.date >= ws && t.date <= we);
  const weekPlanned = week.reduce((s, t) => s + t.minutes, 0);
  const weekDone = week.filter((t) => t.status === "COMPLETED").reduce((s, t) => s + t.minutes, 0);

  // Weekly goals: topics whose last learning/practice session falls in this week.
  const lastStudy = new Map<string, TaskView>();
  for (const t of tasks) if (t.topicId && (t.type === "LEARN" || t.type === "PRACTICE")) lastStudy.set(t.topicId, t);
  const goalTopicIds = [...lastStudy.values()].filter((t) => t.date >= ws && t.date <= we).map((t) => t.topicId!);

  const [topics, lastChange] = await Promise.all([
    db.topic.findMany({
      where: { examId: exam.id },
      select: { id: true, name: true, status: true, priorityScore: true, priorityReasons: true, mastery: true },
    }),
    db.planChange.findFirst({ where: { examId: exam.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const topicById = new Map(topics.map((t) => [t.id, t]));
  const goals = goalTopicIds.map((id) => {
    const t = topicById.get(id)!;
    return { id, name: t.name, done: t.status === "COMPLETED" };
  });
  const priorityTopics = topics
    .filter((t) => t.status !== "COMPLETED")
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 3)
    .map((t) => ({ id: t.id, name: t.name, mastery: t.mastery, why: explainPriority(priorityLevel(t.priorityScore), t.priorityReasons) }));
  const weakTopics = topics.filter((t) => t.status === "NEEDS_REVISION").map((t) => ({ id: t.id, name: t.name }));
  const completedTopics = topics.filter((t) => t.status === "COMPLETED").length;

  return {
    plan,
    health,
    /** False until at least one planned day has passed — health factors mean little before that. */
    hasHistory: tasks.some((t) => t.date < today),
    todayTasks,
    nextDay,
    nextDayTasks: nextDay ? tasks.filter((t) => t.date === nextDay) : [],
    week: { start: ws, planned: weekPlanned, done: weekDone, goals },
    priorityTopics,
    weakTopics,
    syllabus: { completed: completedTopics, total: topics.length },
    lastChange,
  };
}
