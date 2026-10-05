import type { Metadata } from "next";
import Link from "next/link";
import { ReplanPanel } from "@/components/replan-panel";
import { TodaySheet } from "@/components/today-sheet";
import { Meter, Notice, Panel } from "@/components/ui";
import { loadDashboard } from "@/lib/dashboard";
import { diffDays, formatDay, formatMinutes, toDateKey } from "@/lib/dates";
import { requireReadyExam } from "@/lib/session";

export const metadata: Metadata = { title: "Today" };

function greeting(timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(new Date()));
  return hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { user, exam, today, timezone } = await requireReadyExam();
  const { welcome } = await searchParams;
  const d = await loadDashboard(exam, today);
  const examKey = toDateKey(exam.examDate);
  const daysLeft = diffDays(today, examKey);
  const firstName = user.name?.split(" ")[0];
  const { health } = d;
  const prediction = health.prediction;
  const toneFor = (v: number): "good" | "warn" | "risk" => (v >= 0.7 ? "good" : v >= 0.5 ? "warn" : "risk");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold sm:text-4xl">
          {greeting(timezone)}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-2 text-muted">
          {daysLeft > 0 ? `${exam.name} is ${daysLeft} day${daysLeft === 1 ? "" : "s"} away.` : `${exam.name} date has passed. Update it in Settings.`}{" "}
          {d.syllabus.completed} of {d.syllabus.total} topics done.
        </p>
      </header>

      {welcome && d.lastChange && <Notice tone="good">{d.lastChange.summary}</Notice>}

      {health.behindMinutes > 0 && (
        <ReplanPanel
          reason="Catching up on missed work"
          intro={`You have ${formatMinutes(health.behindMinutes)} of unfinished study from earlier days. I can rebuild the rest of your plan around it without overloading any day.`}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-4">
          {d.todayTasks.length > 0 ? (
            <TodaySheet title={formatDay(today)} tasks={d.todayTasks} />
          ) : (
            <Panel title={formatDay(today)}>
              <p className="text-muted">
                {d.nextDay
                  ? `Nothing planned today. Next up is ${formatDay(d.nextDay)}: ${d.nextDayTasks.map((t) => t.title).slice(0, 2).join(", ")}.`
                  : "Nothing left to plan. Add topics on the Syllabus page or rebuild your plan."}
              </p>
            </Panel>
          )}
          {d.weakTopics.length > 0 && (
            <Notice tone="risk">
              Needs more work: {d.weakTopics.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && ", "}
                  <Link href={`/topics/${t.id}`} className="font-bold underline-offset-4 hover:underline">{t.name}</Link>
                </span>
              ))}
              . Extra revision is added when you replan.
            </Notice>
          )}
        </div>

        <aside className="space-y-4">
          <Panel title="Plan health">
            {d.hasHistory ? (
              <p className="flex items-baseline gap-2">
                <span className={`font-display text-4xl font-bold ${health.tone === "good" ? "text-sage" : health.tone === "warn" ? "text-marigold" : "text-rose"}`}>
                  {health.score}
                </span>
                <span className="font-bold">{health.label}</span>
              </p>
            ) : (
              <p className="text-sm text-muted">
                <span className="mb-1 block font-display text-2xl font-bold text-ink">New plan</span>
                Your score starts after your first planned day.
              </p>
            )}
            <ul className="mt-4 space-y-3">
              {health.factors.filter((f) => d.hasHistory || f.label.startsWith("Pace")).map((f) => (
                <li key={f.label} className="space-y-1 text-sm">
                  <span className="flex justify-between">
                    {f.label}
                    <span className="text-muted">{Math.round(f.value * 100)}%</span>
                  </span>
                  <Meter value={f.value} tone={toneFor(f.value)} label={f.label} />
                </li>
              ))}
            </ul>
            {prediction && (
              <p className="mt-4 border-t border-rule pt-4 text-sm">
                {prediction.marginDays >= 0 ? (
                  <>
                    At your {prediction.basis}, you'll finish the syllabus on <strong>{formatDay(prediction.date, { day: "numeric", month: "short" })}</strong>,{" "}
                    {prediction.marginDays} days before the exam.
                    {prediction.eatsIntoRevision && " That cuts into your final revision days."}
                  </>
                ) : (
                  <span className="text-rose">
                    At your {prediction.basis}, you'd finish on {formatDay(prediction.date, { day: "numeric", month: "short" })}, {-prediction.marginDays} days after
                    the exam. Add study hours in Settings or mark topics you already know.
                  </span>
                )}
              </p>
            )}
          </Panel>

          <Panel title="This week">
            <p className="mb-2 text-sm text-muted">
              {formatMinutes(d.week.done)} of {formatMinutes(d.week.planned)} done
            </p>
            <Meter value={d.week.planned ? d.week.done / d.week.planned : 0} tone="good" label="Weekly progress" />
            {d.week.goals.length > 0 && (
              <ul className="mt-4 space-y-1.5 text-sm">
                {d.week.goals.slice(0, 6).map((g) => (
                  <li key={g.id} className={g.done ? "text-muted line-through" : ""}>
                    {g.done ? "✓ " : "○ "}Finish {g.name}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {d.priorityTopics.length > 0 && (
            <Panel title="Top priorities">
              <ul className="space-y-4">
                {d.priorityTopics.map((t) => (
                  <li key={t.id} className="text-sm">
                    <Link href={`/topics/${t.id}`} className="font-bold underline-offset-4 hover:underline">
                      {t.name}
                    </Link>
                    <p className="mt-0.5 text-muted">{t.why}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}
