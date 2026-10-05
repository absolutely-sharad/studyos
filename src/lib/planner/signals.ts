import type { Prisma } from "@/generated/prisma/client";
import { documentText } from "@/lib/documents/process";
import { countMentions, questionKeys } from "@/lib/pyq/frequency";
import { computePriorities, type PriorityResult } from "./priority";

export interface ScoredTopic {
  id: string;
  name: string;
  subjectLevel: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "UNSURE";
  estimatedMinutes: number;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NEEDS_REVISION";
  prerequisites: string[];
  pyqFrequency: number;
  priority: PriorityResult;
}

/** Loads topics with fresh PYQ counts and priority scores (not yet saved). */
export async function scoreTopics(client: Prisma.TransactionClient, examId: string): Promise<ScoredTopic[]> {
  const topics = await client.topic.findMany({
    where: { examId },
    orderBy: { order: "asc" },
    include: {
      subject: { select: { level: true } },
      prerequisites: { where: { kind: "HARD" }, select: { prerequisiteId: true } },
    },
  });

  const pyqDocs = await client.document.findMany({
    where: { examId, category: { in: ["PYQ", "QUESTION_BANK"] }, status: "READY" },
    select: { id: true },
  });
  const keys = questionKeys(await Promise.all(pyqDocs.map((d) => documentText(d.id, client))));

  const withPyq = topics.map((t) => ({
    ...t,
    pyqFrequency: keys.length ? countMentions(keys, [t.name, ...t.aliases]) : 0,
    prereqIds: t.prerequisites.map((p) => p.prerequisiteId),
  }));
  const priorities = computePriorities(
    withPyq.map((t) => ({
      id: t.id,
      name: t.name,
      importance: t.importance,
      difficulty: t.difficulty,
      mastery: t.mastery,
      pyqFrequency: t.pyqFrequency,
      prerequisites: t.prereqIds,
    })),
  );

  return withPyq.map((t) => ({
    id: t.id,
    name: t.name,
    subjectLevel: t.subject.level,
    estimatedMinutes: t.estimatedMinutes,
    status: t.status,
    prerequisites: t.prereqIds,
    pyqFrequency: t.pyqFrequency,
    priority: priorities.get(t.id)!,
  }));
}

export async function saveScores(client: Prisma.TransactionClient, examId: string, scored: ScoredTopic[]) {
  for (const t of scored) {
    await client.topic.update({
      where: { id: t.id, examId },
      data: { pyqFrequency: t.pyqFrequency, priorityScore: t.priority.score, priorityReasons: t.priority.reasons },
    });
  }
}
