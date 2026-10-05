"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { editTask, setPinned } from "@/actions/tasks";
import { Badge, Button, cx, inputBase, inputClass } from "@/components/ui";
import type { TaskView } from "@/lib/dashboard";
import { formatMinutes } from "@/lib/dates";

export function PlanTask({ task, today, examDate }: { task: TaskView; today: string; examDate: string }) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(task.date);
  const [minutes, setMinutes] = useState(task.minutes);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const editable = task.status === "TODO" && task.date >= today;
  const muted = task.status === "COMPLETED" || task.status === "SKIPPED" || task.status === "MISSED";

  return (
    <li className="py-2">
      <div className="flex items-start gap-3">
        <span className={cx("w-16 shrink-0 whitespace-nowrap text-right font-display font-semibold", muted ? "text-muted" : "")}>{formatMinutes(task.minutes)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {task.topicId ? (
              <Link href={`/topics/${task.topicId}`} className={cx("underline-offset-4 hover:underline", muted && "text-muted line-through decoration-1")}>
                {task.title}
              </Link>
            ) : (
              <span className={cx(muted && "text-muted line-through decoration-1")}>{task.title}</span>
            )}
            {task.status === "COMPLETED" && <Badge tone="good">Done</Badge>}
            {task.status === "MISSED" && <Badge tone="risk">Missed</Badge>}
            {task.status === "SKIPPED" && <Badge>Skipped</Badge>}
            {task.pinned && <Badge>Pinned by you</Badge>}
          </div>
          {editing && (
            <form
              className="mt-2 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const res = await editTask(task.id, {
                    ...(date !== task.date && { date }),
                    ...(minutes !== task.minutes && { minutes }),
                  });
                  if (res.error) setError(res.error);
                  else setEditing(false);
                });
              }}
            >
              <label className="text-sm">
                <span className="mb-1 block font-bold">Date</span>
                <input type="date" min={today} max={examDate} value={date} onChange={(e) => setDate(e.target.value)} className={cx(inputBase, "h-9 w-full px-3 text-[15px]")} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-bold">Minutes</span>
                <input
                  type="number"
                  min={5}
                  max={600}
                  step={5}
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                  className={cx(inputBase, "h-9 w-24 px-3 text-[15px]")}
                />
              </label>
              <Button size="sm" className="h-9" disabled={pending}>
                Save
              </Button>
              <Button size="sm" type="button" variant="ghost" className="h-9" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <p className="w-full text-xs text-muted">Edited tasks are pinned: replanning keeps them where you put them.</p>
              {error && <p className="w-full text-sm text-rose">{error}</p>}
            </form>
          )}
        </div>
        {editable && !editing && (
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
            {task.pinned && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => setPinned(task.id, false))}>
                Unpin
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
