import type { Metadata } from "next";
import { PlanTask } from "@/components/plan-task";
import { ReplanPanel } from "@/components/replan-panel";
import { Meter, Notice, Panel, cx } from "@/components/ui";
import { loadPlanState, type TaskView } from "@/lib/dashboard";
import { addDays, formatDay, formatMinutes, toDateKey, weekStart, weekday } from "@/lib/dates";
import { weeklyMinutesOf } from "@/lib/exam-utils";
import { requireReadyExam } from "@/lib/session";

export const metadata: Metadata = { title: "Plan" };

const isStudy = (t: TaskView) => t.type === "LEARN" || t.type === "PRACTICE";

export default async function PlanPage() {
  const { exam, today } = await requireReadyExam();
  const { plan, tasks } = await loadPlanState(exam, today);
  const examDate = toDateKey(exam.examDate);
  const weekly = weeklyMinutesOf(exam);
  const finalStart = plan?.finalRevisionStart ? toDateKey(plan.finalRevisionStart) : null;

  // Monthly roadmap: share of all study work scheduled by the end of each month.
  const studyTasks = tasks.filter((t) => isStudy(t) && t.status !== "SKIPPED" && t.status !== "MISSED");
  const totalStudy = studyTasks.reduce((s, t) => s + t.minutes, 0) + (plan?.unscheduledMinutes ?? 0);
  const months: { key: string; label: string; cumulative: number; done: number; planned: number; review: number }[] = [];
  for (let d = today.slice(0, 7); d <= examDate.slice(0, 7); ) {
    const inMonth = studyTasks.filter((t) => t.date.startsWith(d));
    const through = studyTasks.filter((t) => t.date.slice(0, 7) <= d).reduce((s, t) => s + t.minutes, 0);
    months.push({
      key: d,
      label: new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "UTC" }).format(new Date(`${d}-01T00:00:00Z`)),
      cumulative: totalStudy ? through / totalStudy : 0,
      planned: inMonth.reduce((s, t) => s + t.minutes, 0),
      done: inMonth.filter((t) => t.status === "COMPLETED").reduce((s, t) => s + t.minutes, 0),
      review: tasks
        .filter((t) => (t.type === "REVISION" || t.type === "MOCK") && t.date.startsWith(d) && t.status !== "SKIPPED" && t.status !== "MISSED")
        .reduce((s, t) => s + t.minutes, 0),
    });
    const [y, m] = d.split("-").map(Number);
    d = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }

  const upcoming = tasks.filter((t) => t.date >= today);
  // MISSED means already handled by a replan; only unfinished, unacknowledged work prompts one.
  const missed = tasks.filter((t) => t.date < today && (t.status === "TODO" || t.status === "IN_PROGRESS"));
  const weeks = new Map<string, Map<string, TaskView[]>>();
  for (const t of upcoming) {
    const w = weekStart(t.date);
    if (!weeks.has(w)) weeks.set(w, new Map());
    const days = weeks.get(w)!;
    days.set(t.date, [...(days.get(t.date) ?? []), t]);
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold">Your plan</h1>
        <p className="mt-2 max-w-prose text-muted">
          {plan?.projectedCompletion
            ? `Learning finishes on ${formatDay(toDateKey(plan.projectedCompletion), { day: "numeric", month: "long" })}${
                finalStart ? `, and final revision starts ${formatDay(finalStart, { day: "numeric", month: "long" })}` : ""
              }. Exam on ${formatDay(examDate, { day: "numeric", month: "long" })}.`
            : `Exam on ${formatDay(examDate, { day: "numeric", month: "long" })}.`}
        </p>
      </header>

      {plan?.warnings.map((w) => (
        <Notice key={w} tone="warn">
          {w}
        </Notice>
      ))}
      {missed.length > 0 && (
        <ReplanPanel
          reason="Catching up on missed work"
          intro={`${missed.length} earlier task${missed.length === 1 ? " wasn't" : "s weren't"} finished (${formatMinutes(missed.reduce((s, t) => s + t.minutes, 0))}).`}
        />
      )}

      <Panel title="Roadmap">
        <ul className="space-y-4">
          {months.map((m) => (
            <li key={m.key} className="grid grid-cols-[6.5rem_1fr] items-center gap-3 text-sm">
              <span className="font-bold">{m.label}</span>
              <div className="space-y-1">
                <Meter value={m.cumulative} tone="info" label={`Syllabus scheduled by end of ${m.label}`} />
                <span className="text-muted">
                  {Math.round(m.cumulative * 100)}% of syllabus learned by month end. {formatMinutes(m.planned)} new study
                  {m.done > 0 ? ` (${formatMinutes(m.done)} done)` : ""}, {formatMinutes(m.review)} revision and mocks.
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {[...weeks.entries()].map(([ws, days]) => {
        const all = [...days.values()].flat();
        const goals = [...new Set(all.filter(isStudy).map((t) => t.title.replace(/^(Study|Practice): /, "")))];
        return (
          <section key={ws} aria-labelledby={`w-${ws}`} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-ink pb-2">
              <h2 id={`w-${ws}`} className="text-xl font-semibold">
                Week of {formatDay(ws, { day: "numeric", month: "short" })}
              </h2>
              <span className="text-sm text-muted">
                {formatMinutes(all.reduce((s, t) => s + t.minutes, 0))} planned
                {goals.length > 0 && `, ${goals.length} topic${goals.length === 1 ? "" : "s"}`}
              </span>
            </div>
            {[...days.entries()].map(([date, list]) => {
              const used = list.filter((t) => t.status !== "SKIPPED").reduce((s, t) => s + t.minutes, 0);
              const cap = weekly[weekday(date)] ?? 0;
              return (
                <div key={date} className={cx("rounded-lg border bg-sheet p-4", date === today ? "border-ink" : "border-rule")}>
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-bold">
                      {date === today ? "Today" : date === addDays(today, 1) ? "Tomorrow" : formatDay(date)}
                      {finalStart && date >= finalStart && <span className="ml-2 text-sm font-normal text-margin">Final revision</span>}
                    </h3>
                    <span className={cx("text-sm", used > cap ? "text-rose" : "text-muted")}>
                      {formatMinutes(used)} of {formatMinutes(cap)}
                    </span>
                  </div>
                  <ul className="divide-y divide-rule">
                    {list.map((t) => (
                      <PlanTask key={t.id} task={t} today={today} examDate={addDays(examDate, -1)} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        );
      })}

      {upcoming.length === 0 && <Notice>No upcoming tasks. Rebuild your plan from Materials or Settings.</Notice>}
    </div>
  );
}
