import { db } from "@/lib/db";
import { documentText } from "@/lib/documents/process";
import { parseSyllabusText } from "./heuristic";
import { aiEnabled, extractSyllabusWithAI } from "./llm";
import type { SyllabusDraft } from "./types";

export async function draftSyllabus(examId: string, examName: string, pastedText: string) {
  const docs = await db.document.findMany({
    where: { examId, category: "SYLLABUS", status: "READY" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const texts = await Promise.all(docs.map((d) => documentText(d.id)));
  const text = [pastedText.trim(), ...texts].filter(Boolean).join("\n\n");
  if (!text) return { draft: null, note: "Upload a syllabus file or paste your syllabus text first." };

  let draft: SyllabusDraft | null = null;
  let note: string | null = null;
  if (aiEnabled()) {
    try {
      draft = await extractSyllabusWithAI(text, examName);
    } catch (err) {
      console.error("AI syllabus extraction failed", err);
      note = "AI extraction wasn't available, so the built-in parser was used. Review the topics carefully.";
    }
  }
  if (!draft || draft.subjects.length === 0) draft = parseSyllabusText(text, examName);
  if (draft.subjects.length === 0) return { draft: null, note: "No topics were found in that text. Try pasting the syllabus as a list." };
  return { draft, note };
}

/** Replaces the exam's syllabus (and any plan built on it) with a fresh draft. */
export async function saveDraft(examId: string, draft: SyllabusDraft) {
  await db.$transaction(async (tx) => {
    await tx.studyPlan.deleteMany({ where: { examId } });
    await tx.subject.deleteMany({ where: { examId } });
    await tx.exam.update({ where: { id: examId }, data: { syllabusConfirmedAt: null } });

    const nameToId = new Map<string, string>();
    let order = 0;
    for (const [si, s] of draft.subjects.entries()) {
      const subject = await tx.subject.create({ data: { examId, name: s.name, order: si } });
      const created = await tx.topic.createManyAndReturn({
        data: s.topics.map((t) => ({
          examId,
          subjectId: subject.id,
          name: t.name,
          chapter: t.chapter,
          aliases: t.aliases,
          order: order++,
          difficulty: t.difficulty,
          importance: t.importance,
          estimatedMinutes: t.estimatedMinutes,
          confidence: t.confidence,
          source: "AI" as const,
        })),
        select: { id: true, name: true },
      });
      for (const c of created) nameToId.set(c.name.toLowerCase(), c.id);
    }

    const deps: { prerequisiteId: string; dependentId: string; confidence: number }[] = [];
    for (const s of draft.subjects)
      for (const t of s.topics) {
        const dependentId = nameToId.get(t.name.toLowerCase());
        for (const p of t.prerequisites) {
          const prerequisiteId = nameToId.get(p.toLowerCase());
          if (dependentId && prerequisiteId && prerequisiteId !== dependentId)
            deps.push({ prerequisiteId, dependentId, confidence: t.confidence });
        }
      }
    if (deps.length) await tx.topicDependency.createMany({ data: deps, skipDuplicates: true });
  }, { timeout: 30_000 });
}
