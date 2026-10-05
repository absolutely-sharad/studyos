"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { completeTask, reopenTask, skipTask } from "@/actions/tasks";
import { Badge, Button, buttonClass, cx } from "@/components/ui";
import type { TaskView } from "@/lib/dashboard";
import { formatMinutes } from "@/lib/dates";
import { RATINGS } from "@/lib/mastery";

export const TYPE_LABEL: Record<TaskView["type"], string> = {
  LEARN: "Study",
  PRACTICE: "Practice",
  REVISION: "Revision",
  MOCK: "Mock test",
};

export function RatingPicker({ onPick, disabled }: { onPick: (rating: number) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label="How did it go?" className="flex flex-wrap gap-1">
      {RATINGS.map((r) => (
        <button
          key={r.value}
          type="button"
          disabled={disabled}
          onClick={() => onPick(r.value)}
          className="flex min-w-16 flex-col items-center rounded-md border border-rule bg-sheet px-2 py-1.5 text-xs hover:border-ink-soft disabled:opacity-50"
        >
          <span className="text-xl leading-none" aria-hidden="true">
            {r.emoji}
          </span>
          {r.label}
        </button>
      ))}
    </div>
  );
}

function TaskLine({ task, onMessage }: { task: TaskView; onMessage: (m: string) => void }) {
  const [rating, setRating] = useState(false);
  const [pending, start] = useTransition();
  const done = task.status === "COMPLETED";
  const skipped = task.status === "SKIPPED";
  const high = (task.topicPriority ?? 0) >= 65 && !done;

  return (
    <li className="grid grid-cols-[4.75rem_1fr] border-b border-rule last:border-b-0">
      <div className="px-2 py-4 text-right">
        <span className={cx("whitespace-nowrap font-display text-base font-semibold sm:text-lg", done ? "text-sage" : "text-ink")}>{formatMinutes(task.minutes)}</span>
      </div>
      <div className="min-w-0 space-y-2 py-4 pl-5 pr-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cx("font-bold", (done || skipped) && "text-muted line-through decoration-1")}>{task.title}</span>
          {high && <Badge tone="warn">High priority</Badge>}
          {task.pinned && <Badge>Pinned</Badge>}
          {done && <Badge tone="good">Done</Badge>}
          {skipped && <Badge>Skipped</Badge>}
          {task.status === "IN_PROGRESS" && <Badge tone="info">In progress</Badge>}
        </div>

        {!done && !skipped && !rating && (
          <div className="flex flex-wrap gap-2">
            <Link href={`/study/${task.id}`} className={buttonClass("primary", "sm")}>
              Start
            </Link>
            <Button size="sm" variant="secondary" onClick={() => setRating(true)}>
              Mark done
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => skipTask(task.id))}>
              Skip
            </Button>
          </div>
        )}
        {rating && (
          <div className="space-y-2">
            <p className="text-sm font-bold">How did it go?</p>
            <RatingPicker
              disabled={pending}
              onPick={(r) =>
                start(async () => {
                  const res = await completeTask(task.id, r);
                  setRating(false);
                  if (res.message) onMessage(res.message);
                })
              }
            />
            <Button size="sm" variant="ghost" onClick={() => setRating(false)}>
              Cancel
            </Button>
          </div>
        )}
        {(done || skipped) && (
          <button type="button" disabled={pending} onClick={() => start(() => reopenTask(task.id))} className="text-sm text-muted underline-offset-4 hover:underline">
            Undo
          </button>
        )}
      </div>
    </li>
  );
}

export function TodaySheet({ title, tasks }: { title: string; tasks: TaskView[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const total = tasks.filter((t) => t.status !== "SKIPPED").reduce((s, t) => s + t.minutes, 0);
  const done = tasks.filter((t) => t.status === "COMPLETED").reduce((s, t) => s + t.minutes, 0);
  return (
    <section aria-labelledby="today-heading" className="notebook overflow-hidden rounded-lg border border-rule">
      <div className="grid grid-cols-[4.75rem_1fr] border-b-2 border-rule">
        <span />
        <div className="flex flex-wrap items-baseline justify-between gap-2 py-4 pl-5 pr-4">
          <h2 id="today-heading" className="text-xl font-semibold">
            {title}
          </h2>
          <span className="text-sm text-muted">
            {formatMinutes(done)} of {formatMinutes(total)} done
          </span>
        </div>
      </div>
      <ul>
        {tasks.map((t) => (
          <TaskLine key={t.id} task={t} onMessage={setMessage} />
        ))}
      </ul>
      {message && (
        <p role="status" className="border-t border-rule bg-marigold-soft py-3 pl-[6rem] pr-4 text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
