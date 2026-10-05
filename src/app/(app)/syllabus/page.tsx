import type { Metadata } from "next";
import Link from "next/link";
import { StatusDot, STATUS_META } from "@/components/topic-status";
import { Badge, ButtonLink, cx } from "@/components/ui";
import { priorityLevel } from "@/lib/dashboard";
import { db } from "@/lib/db";
import { requireReadyExam } from "@/lib/session";

export const metadata: Metadata = { title: "Syllabus" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "todo", label: "Not started" },
  { key: "active", label: "In progress" },
  { key: "weak", label: "Needs work" },
  { key: "done", label: "Done" },
] as const;
const MATCH: Record<string, (s: string) => boolean> = {
  all: () => true,
  todo: (s) => s === "NOT_STARTED",
  active: (s) => s === "IN_PROGRESS",
  weak: (s) => s === "NEEDS_REVISION",
  done: (s) => s === "COMPLETED",
};

export default async function SyllabusPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { exam } = await requireReadyExam();
  const { filter = "all" } = await searchParams;
  const match = MATCH[filter] ?? MATCH.all;
  const subjects = await db.subject.findMany({
    where: { examId: exam.id },
    orderBy: { order: "asc" },
    include: { topics: { orderBy: { order: "asc" } } },
  });
  const all = subjects.flatMap((s) => s.topics);
  const done = all.filter((t) => t.status === "COMPLETED").length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Syllabus</h1>
          <p className="mt-2 text-muted">
            {done} of {all.length} topics done.
          </p>
        </div>
        <ButtonLink href="/setup/review" variant="secondary" size="sm">
          Edit topics
        </ButtonLink>
      </header>

      <nav aria-label="Filter topics" className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/syllabus" : `/syllabus?filter=${f.key}`}
            aria-current={filter === f.key ? "page" : undefined}
            className={cx("rounded-md border px-3 py-1.5 text-sm", filter === f.key ? "border-ink bg-ink text-white" : "border-rule bg-sheet hover:border-ink-soft")}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {Object.entries(STATUS_META).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <StatusDot status={k} /> {v.label}
          </span>
        ))}
      </p>

      {subjects.map((s) => {
        const topics = s.topics.filter((t) => match(t.status));
        if (topics.length === 0) return null;
        const chapters = [...new Set(topics.map((t) => t.chapter ?? ""))];
        const subjectDone = s.topics.filter((t) => t.status === "COMPLETED").length;
        return (
          <section key={s.id} className="rounded-lg border border-rule bg-sheet p-5">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-semibold">{s.name}</h2>
              <span className="text-sm text-muted">
                {subjectDone}/{s.topics.length} done
              </span>
            </div>
            {chapters.map((c) => (
              <div key={c || "none"} className="mt-3">
                {c && <h3 className="mb-1 border-l-2 border-margin pl-2 text-sm font-bold text-ink-soft">{c}</h3>}
                <ul>
                  {topics
                    .filter((t) => (t.chapter ?? "") === c)
                    .map((t) => (
                      <li key={t.id}>
                        <Link href={`/topics/${t.id}`} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-paper">
                          <StatusDot status={t.status} />
                          <span className="min-w-0 flex-1 truncate">{t.name}</span>
                          {priorityLevel(t.priorityScore) === "High" && t.status !== "COMPLETED" && <Badge tone="warn">High priority</Badge>}
                          <span className="w-12 text-right text-sm tabular-nums text-muted">{t.mastery}%</span>
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
      {all.filter((t) => match(t.status)).length === 0 && <p className="text-muted">No topics match this filter.</p>}
    </div>
  );
}
