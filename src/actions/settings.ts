"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { fromDateKey } from "@/lib/dates";
import { requireExam } from "@/lib/session";

export interface SettingsState {
  error?: string;
  saved?: boolean;
}

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function updateSettings(_: SettingsState, form: FormData): Promise<SettingsState> {
  const { exam, today } = await requireExam();
  const name = z.string().trim().min(2).max(100).safeParse(form.get("name"));
  if (!name.success) return { error: "Enter the name of your exam." };
  const examDate = dateKey.safeParse(form.get("examDate"));
  if (!examDate.success || examDate.data <= today) return { error: "Your exam date needs to be after today." };

  const weeklyMinutes: Record<string, number> = {};
  for (let d = 0; d < 7; d++) {
    const hours = Number(form.get(`day${d}`) ?? 0);
    if (!Number.isFinite(hours) || hours < 0 || hours > 16) return { error: "Daily study time must be between 0 and 16 hours." };
    weeklyMinutes[String(d)] = Math.round(hours * 60);
  }
  if (Object.values(weeklyMinutes).reduce((s, m) => s + m, 0) < 60) return { error: "Add at least one hour of study time per week." };

  const buffer = Number(form.get("bufferPercent"));
  if (!Number.isInteger(buffer) || buffer < 0 || buffer > 30) return { error: "Spare time must be between 0% and 30%." };

  const unavailable = String(form.get("unavailable") ?? "")
    .split(/[\s,]+/)
    .filter(Boolean);
  if (unavailable.some((d) => !dateKey.safeParse(d).success)) return { error: "Unavailable days must be dates like 2026-10-20." };

  await db.exam.update({
    where: { id: exam.id },
    data: {
      name: name.data,
      examDate: fromDateKey(examDate.data),
      targetScore: String(form.get("targetScore") ?? "").trim().slice(0, 60) || null,
      weeklyMinutes,
      bufferPercent: buffer,
      unavailableDates: [...new Set(unavailable)].filter((d) => d >= today).sort(),
    },
  });
  revalidatePath("/", "layout");
  return { saved: true };
}
