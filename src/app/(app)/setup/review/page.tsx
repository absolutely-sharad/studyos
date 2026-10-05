import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireExam } from "@/lib/session";
import { ReviewEditor, type ReviewSubject } from "./review-editor";

export const metadata: Metadata = { title: "Review your syllabus" };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ note?: string }> }) {
  const { exam } = await requireExam();
  const { note } = await searchParams;
  const subjects = await db.subject.findMany({
    where: { examId: exam.id },
    orderBy: { order: "asc" },
    include: {
      topics: {
        orderBy: { order: "asc" },
        include: { prerequisites: { include: { prerequisite: { select: { id: true, name: true } } } } },
      },
    },
  });
  if (subjects.length === 0 && !exam.syllabusConfirmedAt) redirect("/setup");

  const data: ReviewSubject[] = subjects.map((s) => ({
    id: s.id,
    name: s.name,
    level: s.level,
    topics: s.topics.map((t) => ({
      id: t.id,
      name: t.name,
      chapter: t.chapter,
      importance: t.importance,
      estimatedMinutes: t.estimatedMinutes,
      aliases: t.aliases,
      confidence: t.confidence,
      prerequisites: t.prerequisites.map((p) => ({ dependencyId: p.id, topicId: p.prerequisite.id, name: p.prerequisite.name })),
    })),
  }));

  return <ReviewEditor subjects={data} note={note ?? null} confirmed={Boolean(exam.syllabusConfirmedAt)} />;
}
