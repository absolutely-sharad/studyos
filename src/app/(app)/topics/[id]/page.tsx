import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { setTopicKnown } from "@/actions/syllabus";
import { SourcesList } from "@/components/sources-list";
import { StatusDot, STATUS_META } from "@/components/topic-status";
import { Button, Meter, Panel } from "@/components/ui";
import { priorityLevel } from "@/lib/dashboard";
import { db } from "@/lib/db";
import { formatDay, formatMinutes, toDateKey } from "@/lib/dates";
import { RATINGS } from "@/lib/mastery";
import { explainPriority } from "@/lib/planner/priority";
import { findTopicSources } from "@/lib/resources";
import { requireReadyExam } from "@/lib/session";

export const metadata: Metadata = { title: "Topic" };

const TYPE = { LEARN: "Study", PRACTICE: "Practice", REVISION: "Revision", MOCK: "Mock" } as const;

export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, exam, today } = await requireReadyExam();
  const topic = await db.topic.findFirst({
    where: { id, examId: exam.id },
    include: {
      subject: true,
      prerequisites: { include: { prerequisite: { select: { id: true, name: true, status: true } } } },
      dependents: { include: { dependent: { select: { id: true, name: true, status: true } } } },
      tasks: { orderBy: [{ date: "asc" }, { order: "asc" }] },
    },
  });
  if (!topic) notFound();
  const sources = await findTopicSources(exam.id, user.id, [topic.name, ...topic.aliases]);
  const history = topic.tasks.filter((t) => t.status === "COMPLETED");
  const upcoming = topic.tasks.filter((t) => t.status === "TODO" && toDateKey(t.date) >= today).slice(0, 5);
  const level = priorityLevel(topic.priorityScore);
  const known = topic.status === "COMPLETED";

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-muted">
          <Link href="/syllabus" className="underline-offset-4 hover:underline">{topic.subject.name}</Link>
          {topic.chapter ? ` / ${topic.chapter}` : ""}
        </p>
        <h1 className="mt-1 text-3xl font-bold">{topic.name}</h1>
        <p className="mt-2 inline-flex items-center gap-2 text-muted">
          <StatusDot status={topic.status} /> {STATUS_META[topic.status]?.label}
          {topic.aliases.length > 0 && <span>, also called {topic.aliases.join(", ")}</span>}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel title="Why it matters">
          <p className="font-display text-3xl font-bold">
            {topic.priorityScore}
            <span className="ml-2 text-base font-normal text-muted">{level} priority</span>
          </p>
          <p className="mt-2 text-sm">{explainPriority(level, topic.priorityReasons)}</p>
          {topic.pyqFrequency > 0 && <p className="mt-2 text-sm text-muted">Mentioned in {topic.pyqFrequency} previous-year questions.</p>}
        </Panel>
        <Panel title="Your mastery">
          <p className="mb-2 font-display text-3xl font-bold">{topic.mastery}%</p>
          <Meter value={topic.mastery / 100} tone={topic.mastery >= 70 ? "good" : topic.mastery >= 40 ? "warn" : "risk"} label="Mastery" />
          <p className="mt-3 text-sm text-muted">
            Estimated {formatMinutes(topic.estimatedMinutes)} of study. {history.length} session{history.length === 1 ? "" : "s"} done.
          </p>
          <form action={setTopicKnown.bind(null, topic.id, !known)} className="mt-3">
            <Button size="sm" variant="secondary">
              {known ? "Mark as not done" : "I already know this"}
            </Button>
          </form>
        </Panel>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel title="Study first">
          {topic.prerequisites.length === 0 ? (
            <p className="text-sm text-muted">No prerequisites.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {topic.prerequisites.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <StatusDot status={p.prerequisite.status} />
                  <Link href={`/topics/${p.prerequisite.id}`} className="underline-offset-4 hover:underline">{p.prerequisite.name}</Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Unlocks">
          {topic.dependents.length === 0 ? (
            <p className="text-sm text-muted">No other topics depend on this one.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {topic.dependents.map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <StatusDot status={d.dependent.status} />
                  <Link href={`/topics/${d.dependent.id}`} className="underline-offset-4 hover:underline">{d.dependent.name}</Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="In your materials">
        <SourcesList sources={sources} empty="This topic isn't mentioned in your uploaded files. Add notes on the Materials page." />
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel title="Coming up">
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted">Nothing scheduled.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {upcoming.map((t) => (
                <li key={t.id}>
                  {formatDay(toDateKey(t.date), { weekday: "short", day: "numeric", month: "short" })}: {TYPE[t.type]}, {formatMinutes(t.minutes)}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="History">
          {history.length === 0 ? (
            <p className="text-sm text-muted">No sessions yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {history.map((t) => {
                const r = RATINGS.find((x) => x.value === t.rating);
                return (
                  <li key={t.id}>
                    {formatDay(toDateKey(t.date), { day: "numeric", month: "short" })}: {TYPE[t.type]}, {formatMinutes(t.minutes)}
                    {r && <span title={r.label}> {r.emoji}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
