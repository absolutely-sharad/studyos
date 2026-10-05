"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { formatDay, fromDateKey, toDateKey } from "@/lib/dates";
import { requireReadyExam } from "@/lib/session";
import { addSupportRevision, findOwnedTask, refreshTopicMastery } from "@/lib/tasks";

async function ownedTask(taskId: string) {
  const ctx = await requireReadyExam();
  const task = await findOwnedTask(ctx.user.id, taskId);
  if (!task || task.examId !== ctx.exam.id) throw new Error("Task not found.");
  return { ...ctx, task };
}

const refresh = () => {
  revalidatePath("/dashboard");
  revalidatePath("/plan");
  revalidatePath("/syllabus");
};

export async function startTask(taskId: string) {
  const { task } = await ownedTask(taskId);
  if (task.status === "TODO" || task.status === "MISSED")
    await db.studyTask.update({ where: { id: task.id }, data: { status: "IN_PROGRESS" } });
  refresh();
}

export interface CompleteResult {
  message: string | null;
}

/** Rating 1 (very difficult) … 5 (easy) feeds topic mastery and weak-topic detection. */
export async function completeTask(taskId: string, rating: number): Promise<CompleteResult> {
  const { task, exam, today } = await ownedTask(taskId);
  const r = z.number().int().min(1).max(5).parse(rating);
  await db.studyTask.update({ where: { id: task.id }, data: { status: "COMPLETED", rating: r, completedAt: new Date() } });

  let message: string | null = null;
  if (task.topicId) {
    const { weak } = await refreshTopicMastery(task.topicId);
    if (weak) {
      const topic = await db.topic.findUniqueOrThrow({ where: { id: task.topicId } });
      const date = await addSupportRevision(exam, topic, today);
      message = date
        ? `${topic.name} felt tough, so I added a 20-minute revision on ${formatDay(date)}.`
        : `${topic.name} felt tough. Your next few days are full, so it gets extra revision at your next replan.`;
    }
  }
  refresh();
  return { message };
}

export async function skipTask(taskId: string) {
  const { task } = await ownedTask(taskId);
  await db.studyTask.update({ where: { id: task.id }, data: { status: "SKIPPED" } });
  refresh();
}

export async function reopenTask(taskId: string) {
  const { task, today } = await ownedTask(taskId);
  const status = toDateKey(task.date) < today ? "MISSED" : "TODO";
  await db.studyTask.update({ where: { id: task.id }, data: { status, rating: null, completedAt: null } });
  if (task.topicId) await refreshTopicMastery(task.topicId);
  refresh();
}

/** Manual edits pin the task so replanning never moves it without asking. */
export async function editTask(taskId: string, patch: { date?: string; minutes?: number }): Promise<{ error?: string }> {
  const { task, exam, today } = await ownedTask(taskId);
  const data: { date?: Date; minutes?: number; order?: number } = {};

  if (patch.date !== undefined) {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(patch.date);
    if (date < today) return { error: "Pick today or a later date." };
    if (date >= toDateKey(exam.examDate)) return { error: "Pick a date before your exam." };
    if (exam.unavailableDates.includes(date)) return { error: "You marked that day as unavailable." };
    data.date = fromDateKey(date);
    data.order = await db.studyTask.count({ where: { examId: exam.id, date: data.date } });
  }
  if (patch.minutes !== undefined) data.minutes = z.number().int().min(5).max(600).parse(patch.minutes);

  await db.studyTask.update({ where: { id: task.id }, data: { ...data, pinned: true, source: "USER" } });
  refresh();
  return {};
}

export async function setPinned(taskId: string, pinned: boolean) {
  const { task } = await ownedTask(taskId);
  await db.studyTask.update({ where: { id: task.id }, data: { pinned } });
  refresh();
}
