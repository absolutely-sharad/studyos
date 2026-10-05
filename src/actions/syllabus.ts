"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { LEVEL_START_MASTERY } from "@/lib/config";
import { db } from "@/lib/db";
import { applyPlan } from "@/lib/planner/service";
import { requireExam } from "@/lib/session";
import { draftSyllabus, saveDraft } from "@/lib/syllabus/service";

export interface ActionState {
  error?: string;
  message?: string;
}

/** Reads uploaded syllabus files (+ pasted text) and saves a draft topic map for review. */
export async function buildTopicMap(_: ActionState, form: FormData): Promise<ActionState> {
  const { exam } = await requireExam();
  const pasted = String(form.get("pasted") ?? "").slice(0, 100_000);
  const { draft, note } = await draftSyllabus(exam.id, exam.name, pasted);
  if (!draft) return { error: note ?? "No topics were found." };
  await saveDraft(exam.id, draft);
  revalidatePath("/", "layout");
  redirect(note ? `/setup/review?note=${encodeURIComponent(note)}` : "/setup/review");
}

async function ownedTopic(topicId: string) {
  const { exam } = await requireExam();
  const topic = await db.topic.findFirst({ where: { id: topicId, examId: exam.id } });
  if (!topic) throw new Error("Topic not found.");
  return { exam, topic };
}

async function ownedSubject(subjectId: string) {
  const { exam } = await requireExam();
  const subject = await db.subject.findFirst({ where: { id: subjectId, examId: exam.id } });
  if (!subject) throw new Error("Subject not found.");
  return { exam, subject };
}

const refresh = () => {
  revalidatePath("/setup/review");
  revalidatePath("/syllabus");
  revalidatePath("/topics", "layout");
};

const topicPatch = z
  .object({
    name: z.string().trim().min(2).max(90),
    chapter: z.string().trim().max(90).nullable(),
    importance: z.number().int().min(1).max(5),
    difficulty: z.number().int().min(1).max(5),
    estimatedMinutes: z.number().int().min(15).max(1200),
  })
  .partial();

export async function updateTopic(topicId: string, patch: z.input<typeof topicPatch>) {
  const { topic } = await ownedTopic(topicId);
  const data = topicPatch.parse(patch);
  await db.topic.update({ where: { id: topic.id }, data: { ...data, source: "USER" } });
  refresh();
}

export async function deleteTopic(topicId: string) {
  const { topic } = await ownedTopic(topicId);
  await db.topic.delete({ where: { id: topic.id } });
  refresh();
}

export async function addTopic(subjectId: string, name: string) {
  const { exam, subject } = await ownedSubject(subjectId);
  const clean = z.string().trim().min(2).max(90).parse(name);
  const last = await db.topic.aggregate({ where: { examId: exam.id }, _max: { order: true } });
  await db.topic.create({
    data: { examId: exam.id, subjectId: subject.id, name: clean, order: (last._max.order ?? 0) + 1, source: "USER", confidence: 1 },
  });
  refresh();
}

/** Merges `sourceId` into `targetId`: aliases and prerequisites move over, the source is removed. */
export async function mergeTopics(sourceId: string, targetId: string) {
  const { topic: source } = await ownedTopic(sourceId);
  const { topic: target } = await ownedTopic(targetId);
  if (source.id === target.id) return;
  await db.$transaction(async (tx) => {
    const deps = await tx.topicDependency.findMany({
      where: { OR: [{ prerequisiteId: source.id }, { dependentId: source.id }] },
    });
    for (const d of deps) {
      const prerequisiteId = d.prerequisiteId === source.id ? target.id : d.prerequisiteId;
      const dependentId = d.dependentId === source.id ? target.id : d.dependentId;
      if (prerequisiteId === dependentId) continue;
      await tx.topicDependency.upsert({
        where: { prerequisiteId_dependentId: { prerequisiteId, dependentId } },
        create: { prerequisiteId, dependentId, kind: d.kind, confidence: d.confidence },
        update: {},
      });
    }
    await tx.topic.update({
      where: { id: target.id },
      data: {
        aliases: [...new Set([...target.aliases, source.name, ...source.aliases])].filter((a) => a !== target.name),
        estimatedMinutes: Math.min(1200, Math.max(target.estimatedMinutes, source.estimatedMinutes)),
        importance: Math.max(target.importance, source.importance),
        source: "USER",
      },
    });
    await tx.topic.delete({ where: { id: source.id } });
  });
  refresh();
}

export async function moveTopic(topicId: string, direction: "up" | "down") {
  const { topic } = await ownedTopic(topicId);
  const neighbour = await db.topic.findFirst({
    where: { subjectId: topic.subjectId, order: direction === "up" ? { lt: topic.order } : { gt: topic.order } },
    orderBy: { order: direction === "up" ? "desc" : "asc" },
  });
  if (!neighbour) return;
  await db.$transaction([
    db.topic.update({ where: { id: topic.id }, data: { order: neighbour.order } }),
    db.topic.update({ where: { id: neighbour.id }, data: { order: topic.order } }),
  ]);
  refresh();
}

export async function removeDependency(dependencyId: string) {
  const { exam } = await requireExam();
  await db.topicDependency.deleteMany({ where: { id: dependencyId, dependent: { examId: exam.id } } });
  refresh();
}

export async function addDependency(dependentId: string, prerequisiteId: string) {
  const { topic: dependent } = await ownedTopic(dependentId);
  const { topic: prerequisite } = await ownedTopic(prerequisiteId);
  if (dependent.id === prerequisite.id) return;
  await db.topicDependency.upsert({
    where: { prerequisiteId_dependentId: { prerequisiteId: prerequisite.id, dependentId: dependent.id } },
    create: { prerequisiteId: prerequisite.id, dependentId: dependent.id, kind: "HARD", confidence: 1 },
    update: { kind: "HARD" },
  });
  refresh();
}

const levelSchema = z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "UNSURE"]);

export async function updateSubject(subjectId: string, patch: { name?: string; level?: string }) {
  const { subject } = await ownedSubject(subjectId);
  await db.subject.update({
    where: { id: subject.id },
    data: {
      ...(patch.name !== undefined && { name: z.string().trim().min(2).max(90).parse(patch.name) }),
      ...(patch.level !== undefined && { level: levelSchema.parse(patch.level) }),
    },
  });
  refresh();
}

export async function addSubject(name: string) {
  const { exam } = await requireExam();
  const clean = z.string().trim().min(2).max(90).parse(name);
  const count = await db.subject.count({ where: { examId: exam.id } });
  await db.subject.create({ data: { examId: exam.id, name: clean, order: count } });
  refresh();
}

export async function deleteSubject(subjectId: string) {
  const { subject } = await ownedSubject(subjectId);
  await db.subject.delete({ where: { id: subject.id } });
  refresh();
}

/** Human-in-the-loop gate: only a confirmed syllabus gets a plan. */
export async function confirmSyllabus(): Promise<ActionState> {
  const { exam, today } = await requireExam();
  const topics = await db.topic.count({ where: { examId: exam.id } });
  if (topics === 0) return { error: "Add at least one topic before building your plan." };

  // Starting mastery comes from the level the student chose for each subject.
  const subjects = await db.subject.findMany({ where: { examId: exam.id } });
  for (const s of subjects) {
    await db.topic.updateMany({
      where: { subjectId: s.id, status: "NOT_STARTED", mastery: 0 },
      data: { mastery: LEVEL_START_MASTERY[s.level] },
    });
  }

  await db.exam.update({ where: { id: exam.id }, data: { syllabusConfirmedAt: new Date() } });
  await applyPlan(exam.id, today, "initial", "Syllabus confirmed");
  revalidatePath("/", "layout");
  redirect("/dashboard?welcome=1");
}

/** Topic page: the student already knows this — stop scheduling learning for it. */
export async function setTopicKnown(topicId: string, known: boolean) {
  const { topic } = await ownedTopic(topicId);
  await db.topic.update({
    where: { id: topic.id },
    data: known ? { status: "COMPLETED", mastery: Math.max(topic.mastery, 80) } : { status: "NOT_STARTED" },
  });
  refresh();
  revalidatePath("/dashboard");
}
