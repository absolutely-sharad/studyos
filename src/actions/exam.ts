"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { todayKey, fromDateKey } from "@/lib/dates";
import { requireUser } from "@/lib/session";

const CATEGORIES = ["COMPETITIVE", "UNIVERSITY", "PLACEMENT", "INTERVIEW", "CERTIFICATION", "CUSTOM"] as const;

const examSchema = z.object({
  category: z.enum(CATEGORIES),
  customCategory: z.string().trim().max(60).optional(),
  name: z.string().trim().min(2, "Enter the name of your exam.").max(100),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick your exam date."),
  targetScore: z.string().trim().max(60).optional(),
  weeklyMinutes: z.record(z.string().regex(/^[0-6]$/), z.number().int().min(0).max(960)),
  preferredTimes: z.array(z.enum(["MORNING", "AFTERNOON", "EVENING", "NIGHT"])).max(4),
  learningStyles: z.array(z.string().max(30)).max(10),
  timezone: z.string().max(64),
});

export type ExamInput = z.infer<typeof examSchema>;

function safeTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "Asia/Kolkata";
  }
}

export async function createExam(input: ExamInput): Promise<{ error: string } | void> {
  const user = await requireUser();
  const parsed = examSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your details and try again." };
  const data = parsed.data;
  const timezone = safeTimezone(data.timezone);

  if (data.examDate <= todayKey(timezone)) return { error: "Your exam date needs to be after today." };
  const weekly = Object.values(data.weeklyMinutes).reduce((s, m) => s + m, 0);
  if (weekly < 60) return { error: "Add at least one hour of study time per week." };
  if (data.category === "CUSTOM" && !data.customCategory) return { error: "Tell us what you're preparing for." };

  await db.$transaction([
    db.exam.updateMany({ where: { userId: user.id, isActive: true }, data: { isActive: false } }),
    db.exam.create({
      data: {
        userId: user.id,
        name: data.name,
        category: data.category,
        customCategory: data.category === "CUSTOM" ? data.customCategory : null,
        examDate: fromDateKey(data.examDate),
        targetScore: data.targetScore || null,
        weeklyMinutes: data.weeklyMinutes,
        preferredTimes: data.preferredTimes,
      },
    }),
    db.userPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, timezone, learningStyles: data.learningStyles },
      update: { timezone, learningStyles: data.learningStyles },
    }),
  ]);
  redirect("/setup");
}
