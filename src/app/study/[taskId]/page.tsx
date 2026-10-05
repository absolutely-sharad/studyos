import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SourcesList } from "@/components/sources-list";
import { db } from "@/lib/db";
import { findTopicSources } from "@/lib/resources";
import { requireReadyExam } from "@/lib/session";
import { StudySession } from "./study-session";

export const metadata: Metadata = { title: "Focus" };

const OBJECTIVE = {
  LEARN: (t: string) => `Understand the core ideas of ${t} well enough to explain them without notes.`,
  PRACTICE: (t: string) => `Solve problems on ${t}. Write down every mistake and why it happened.`,
  REVISION: (t: string) => `Recall ${t} from memory first, then check your notes for gaps.`,
  MOCK: () => "Attempt a full paper under exam conditions, then review every mistake.",
};

export default async function StudyPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const { user, exam } = await requireReadyExam();
  const task = await db.studyTask.findFirst({ where: { id: taskId, examId: exam.id }, include: { topic: true } });
  if (!task) notFound();
  const topicName = task.topic?.name ?? exam.name;
  const sources = task.topic ? await findTopicSources(exam.id, user.id, [task.topic.name, ...task.topic.aliases]) : [];

  return (
    <StudySession
      task={{ id: task.id, title: task.title, type: task.type, minutes: task.minutes, status: task.status }}
      objective={OBJECTIVE[task.type](topicName)}
      sources={<SourcesList sources={sources} empty="This topic isn't mentioned in your uploaded materials yet." />}
    />
  );
}
