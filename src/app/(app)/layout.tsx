import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { Wordmark } from "@/components/brand";
import { diffDays, toDateKey, todayKey } from "@/lib/dates";
import { db } from "@/lib/db";
import { getActiveExam, requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [exam, pref] = await Promise.all([getActiveExam(user.id), db.userPreference.findUnique({ where: { userId: user.id } })]);
  const daysLeft = exam ? diffDays(todayKey(pref?.timezone ?? "Asia/Kolkata"), toDateKey(exam.examDate)) : null;

  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-60 shrink-0 border-r border-rule bg-sheet md:flex md:flex-col">
        <div className="sticky top-0 flex h-dvh flex-col gap-8 p-5">
          <Wordmark href="/dashboard" />
          {exam && (
            <Link href="/settings" className="rounded-md border border-rule p-3 hover:border-ink-soft">
              <span className="block truncate font-bold">{exam.name}</span>
              <span className="text-sm text-muted">
                {daysLeft !== null && daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} to go` : "Exam day has passed"}
              </span>
            </Link>
          )}
          <AppNav variant="side" />
        </div>
      </aside>
      <header className="flex items-center justify-between border-b border-rule bg-sheet px-5 py-3 md:hidden">
        <Wordmark href="/dashboard" />
        {exam && daysLeft !== null && <span className="text-sm text-muted">{daysLeft > 0 ? `${daysLeft} days to go` : ""}</span>}
      </header>
      <main className="min-w-0 flex-1 px-5 pb-28 pt-6 md:px-10 md:pb-12 md:pt-10">
        <div className="mx-auto max-w-4xl">{children}</div>
      </main>
      <AppNav variant="bottom" />
    </div>
  );
}
