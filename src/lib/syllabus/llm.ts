import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { cleanTopicName, dedupeDraft } from "./normalize";
import type { SyllabusDraft } from "./types";

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

const clampInt = (lo: number, hi: number, fallback: number) =>
  z.coerce.number().catch(fallback).transform((n) => Math.min(hi, Math.max(lo, Math.round(n))));

const responseSchema = z.object({
  subjects: z.array(
    z.object({
      name: z.string().min(1),
      topics: z.array(
        z.object({
          name: z.string().min(1),
          chapter: z.string().nullish(),
          aliases: z.array(z.string()).catch([]).default([]),
          difficulty: clampInt(1, 5, 3),
          importance: clampInt(1, 5, 3),
          estimatedMinutes: clampInt(20, 900, 120),
          prerequisites: z.array(z.string()).catch([]).default([]),
        }),
      ),
    }),
  ),
});

const SYSTEM = `You turn a student's syllabus into a structured study map for a study planner.
Rules:
- Use only topics present in the syllabus text. Never invent topics.
- Group topics under their subject; keep the syllabus's own chapter/unit name in "chapter".
- Size each topic as one study unit of roughly 1–5 hours. Merge items that are too small; split items that are too broad.
- Merge duplicates and list other spellings in "aliases".
- "prerequisites": names (exactly as written in your output) of topics that must be understood first. Only include real, hard prerequisites.
- "difficulty" 1–5 for an average student. "importance" 1–5 from emphasis, marks or weightage stated in the syllabus (3 if unstated).
- "estimatedMinutes": learning plus practice time for an average student.
Respond with JSON only, no prose, in this shape:
{"subjects":[{"name":"","topics":[{"name":"","chapter":"","aliases":[],"difficulty":3,"importance":3,"estimatedMinutes":120,"prerequisites":[]}]}]}`;

export async function extractSyllabusWithAI(text: string, examName: string): Promise<SyllabusDraft> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    max_tokens: 12000,
    system: SYSTEM,
    messages: [{ role: "user", content: `Exam: ${examName}\n\nSyllabus text:\n"""\n${text.slice(0, 80_000)}\n"""` }],
  });
  const raw = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const parsed = responseSchema.parse(JSON.parse(json));

  const subjects = parsed.subjects.map((s) => ({
    name: cleanTopicName(s.name) ?? s.name,
    topics: s.topics.flatMap((t) => {
      const name = cleanTopicName(t.name);
      if (!name) return [];
      return [{
        name,
        chapter: t.chapter?.trim() || null,
        aliases: t.aliases.map((a) => a.trim()).filter(Boolean),
        difficulty: t.difficulty,
        importance: t.importance,
        estimatedMinutes: Math.round(t.estimatedMinutes / 5) * 5,
        prerequisites: t.prerequisites,
        confidence: 0.85,
      }];
    }),
  }));
  return { subjects: dedupeDraft(subjects), source: "ai" };
}
