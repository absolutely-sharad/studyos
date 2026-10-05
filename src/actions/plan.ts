"use server";

import { revalidatePath } from "next/cache";
import { applyPlan, previewReplan, type PlanSummary } from "@/lib/planner/service";
import { requireReadyExam } from "@/lib/session";

export async function previewReplanAction(): Promise<PlanSummary> {
  const { exam, today } = await requireReadyExam();
  return previewReplan(exam.id, today);
}

/** Major plan changes only happen after the student confirms the preview. */
export async function applyReplanAction(reason: string): Promise<PlanSummary> {
  const { exam, today } = await requireReadyExam();
  const summary = await applyPlan(exam.id, today, "replan", reason.slice(0, 120) || "Replanned");
  revalidatePath("/", "layout");
  return summary;
}
