"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { completeTask, startTask } from "@/actions/tasks";
import { BrandMark } from "@/components/brand";
import { RatingPicker, TYPE_LABEL } from "@/components/today-sheet";
import { Button, buttonClass, cx } from "@/components/ui";

type Mode = "countdown" | "pomodoro" | "stopwatch";

function clock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h > 0 ? `${h}:` : ""}${String(m).padStart(h > 0 ? 2 : 1, "0")}:${String(r).padStart(2, "0")}`;
}

export function StudySession({
  task,
  objective,
  sources,
}: {
  task: { id: string; title: string; type: "LEARN" | "PRACTICE" | "REVISION" | "MOCK"; minutes: number; status: string };
  objective: string;
  sources: React.ReactNode;
}) {
  const [mode, setMode] = useState<Mode>("countdown");
  const [running, setRunning] = useState(false);
  // ticks: seconds since the timer mode was chosen (breaks included); focus: seconds of actual study.
  const [time, setTime] = useState({ ticks: 0, focus: 0 });
  const [finishing, setFinishing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const startedRef = useRef(false);

  const FOCUS = 25 * 60;
  const CYCLE = 30 * 60;
  const pos = time.ticks % CYCLE;
  const phase: "focus" | "break" = pos < FOCUS ? "focus" : "break";
  const elapsed = time.focus;
  const shown =
    mode === "stopwatch" ? elapsed : mode === "countdown" ? task.minutes * 60 - elapsed : phase === "focus" ? FOCUS - pos : CYCLE - pos;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setTime((t) => {
        const inFocus = mode !== "pomodoro" || t.ticks % CYCLE < FOCUS;
        return { ticks: t.ticks + 1, focus: t.focus + (inFocus ? 1 : 0) };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, mode, CYCLE, FOCUS]);

  useEffect(() => {
    if (mode === "countdown" && running && elapsed >= task.minutes * 60) setRunning(false);
  }, [elapsed, mode, running, task.minutes]);

  useEffect(() => {
    document.title = running ? `${clock(shown)} · ${task.title}` : task.title;
  }, [running, shown, task.title]);

  function toggle() {
    if (!startedRef.current && task.status === "TODO") {
      startedRef.current = true;
      start(() => startTask(task.id));
    }
    setRunning((r) => !r);
  }

  const done = task.status === "COMPLETED" || result !== null;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-5 py-4">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-ink-soft hover:text-ink">
          <BrandMark size={22} /> Back to today
        </Link>
        <span className="text-sm text-muted">{TYPE_LABEL[task.type]}</span>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-5 pb-16">
        <div>
          <h1 className="text-3xl font-bold sm:text-4xl">{task.title}</h1>
          <p className="mt-3 text-lg text-ink-soft">{objective}</p>
        </div>

        {!done && !finishing && (
          <section aria-label="Timer" className="space-y-5">
            <div role="radiogroup" aria-label="Timer mode" className="flex gap-1 rounded-md bg-sky-soft p-1 text-sm">
              {(
                [
                  ["countdown", `${task.minutes} min`],
                  ["pomodoro", "Pomodoro 25/5"],
                  ["stopwatch", "Stopwatch"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => {
                    setMode(m);
                    setTime((t) => ({ ticks: 0, focus: t.focus }));
                  }}
                  className={cx("flex-1 rounded px-2 py-1.5", mode === m ? "bg-sheet font-bold shadow-sm" : "text-ink-soft")}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="font-display text-7xl font-semibold tabular-nums tracking-tight sm:text-8xl" aria-live="off">
              {clock(shown)}
            </p>
            {mode === "pomodoro" && <p className="text-muted">{phase === "focus" ? "Focus" : "Break — stand up, drink water"}</p>}
            {mode === "countdown" && elapsed >= task.minutes * 60 && <p className="font-bold text-sage">Time's up. Finish when you're ready.</p>}
            <p className="text-sm text-muted">{Math.floor(elapsed / 60)} minutes of focus so far.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="lg" onClick={toggle}>
                {running ? "Pause" : elapsed > 0 ? "Resume" : "Start timer"}
              </Button>
              <Button size="lg" variant="secondary" onClick={() => { setRunning(false); setFinishing(true); }}>
                Finish session
              </Button>
            </div>
          </section>
        )}

        {finishing && !done && (
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">How did it go?</h2>
            <p className="text-muted">Your answer adjusts how much revision this topic gets.</p>
            <RatingPicker
              disabled={pending}
              onPick={(r) =>
                start(async () => {
                  const res = await completeTask(task.id, r);
                  setResult(res.message ?? "Session saved. Nice work.");
                })
              }
            />
            <Button variant="ghost" onClick={() => setFinishing(false)}>
              Back to timer
            </Button>
          </section>
        )}

        {done && (
          <section className="space-y-4">
            <p className="text-lg">{result ?? "This session is already marked done."}</p>
            <Link href="/dashboard" className={buttonClass("primary", "lg")}>
              Back to today
            </Link>
          </section>
        )}

        <section className="border-t border-rule pt-6">
          <h2 className="mb-3 text-lg font-semibold">From your materials</h2>
          {sources}
        </section>
      </main>
    </div>
  );
}
