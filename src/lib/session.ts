import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { todayKey } from "@/lib/dates";

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return { id: session.user.id, name: session.user.name ?? null, email: session.user.email ?? null };
}

export function getActiveExam(userId: string) {
  return db.exam.findFirst({ where: { userId, isActive: true }, orderBy: { createdAt: "desc" } });
}

/** Signed-in user + their active exam; redirects to onboarding if there is none. */
export async function requireExam() {
  const user = await requireUser();
  const exam = await getActiveExam(user.id);
  if (!exam) redirect("/onboarding");
  const pref = await db.userPreference.findUnique({ where: { userId: user.id } });
  const timezone = pref?.timezone ?? "Asia/Kolkata";
  return { user, exam, timezone, today: todayKey(timezone) };
}

/** Like requireExam, but also requires a confirmed syllabus (i.e. a plan exists). */
export async function requireReadyExam() {
  const ctx = await requireExam();
  if (!ctx.exam.syllabusConfirmedAt) redirect("/setup");
  return ctx;
}

export { weeklyMinutesOf } from "@/lib/exam-utils";
