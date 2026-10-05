"use client";

import { useActionState, useState } from "react";
import { updateSettings } from "@/actions/settings";
import { ReplanPanel } from "@/components/replan-panel";
import { Button, Field, cx, inputBase, inputClass } from "@/components/ui";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function SettingsForm({
  initial,
  canReplan,
}: {
  initial: { name: string; examDate: string; targetScore: string; hours: number[]; bufferPercent: number; unavailable: string[] };
  canReplan: boolean;
}) {
  const [state, action, pending] = useActionState(updateSettings, {});
  const [unavailable, setUnavailable] = useState(initial.unavailable);
  const [newDay, setNewDay] = useState("");

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Exam name" htmlFor="name">
            <input id="name" name="name" defaultValue={initial.name} required className={inputClass} />
          </Field>
          <Field label="Exam date" htmlFor="examDate">
            <input id="examDate" name="examDate" type="date" defaultValue={initial.examDate} required className={inputClass} />
          </Field>
        </div>
        <Field label="Target score or rank" htmlFor="targetScore">
          <input id="targetScore" name="targetScore" defaultValue={initial.targetScore} className={inputClass} />
        </Field>

        <fieldset>
          <legend className="mb-2 text-sm font-bold">Study hours per day</legend>
          <div className="grid grid-cols-7 gap-2">
            {DAYS.map((d, i) => (
              <label key={d} className="text-center">
                <span className="mb-1 block text-sm">{d}</span>
                <input
                  name={`day${i}`}
                  type="number"
                  min={0}
                  max={16}
                  step={0.5}
                  defaultValue={initial.hours[i]}
                  aria-label={`Hours on ${d}`}
                  className={cx(inputBase, "px-1 text-center w-full py-2 text-[15px]")}
                />
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Spare time each day" htmlFor="bufferPercent" hint="Held back for overruns and bad days. Your plan never uses it.">
          <select id="bufferPercent" name="bufferPercent" defaultValue={initial.bufferPercent} className={cx(inputBase, "w-auto px-3 py-2 text-[15px]")}>
            {[0, 5, 10, 15, 20, 25, 30].map((p) => (
              <option key={p} value={p}>
                {p}%
              </option>
            ))}
          </select>
        </Field>

        <fieldset>
          <legend className="mb-2 text-sm font-bold">Days you can't study</legend>
          <input type="hidden" name="unavailable" value={unavailable.join(",")} />
          <div className="flex flex-wrap gap-2">
            {unavailable.map((d) => (
              <span key={d} className="inline-flex items-center gap-1 rounded bg-sky-soft px-2 py-1 text-sm">
                {d}
                <button type="button" aria-label={`Remove ${d}`} onClick={() => setUnavailable(unavailable.filter((x) => x !== d))} className="px-1 font-bold hover:text-rose">
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input type="date" value={newDay} onChange={(e) => setNewDay(e.target.value)} aria-label="Add a day you can't study" className={cx(inputBase, "h-9 w-auto px-3 text-[15px]")} />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-9"
              onClick={() => {
                if (newDay && !unavailable.includes(newDay)) setUnavailable([...unavailable, newDay].sort());
                setNewDay("");
              }}
            >
              Add day
            </Button>
          </div>
        </fieldset>

        {state.error && (
          <p role="alert" className="rounded-md bg-rose-soft px-3 py-2 text-sm text-rose">
            {state.error}
          </p>
        )}
        <Button disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button>
      </form>

      {state.saved && canReplan && (
        <ReplanPanel
          tone="info"
          reason="Settings changed"
          intro="Settings saved. Your current plan still uses the old settings. Preview a plan built with the new ones?"
          buttonLabel="Preview new plan"
        />
      )}
      {state.saved && !canReplan && <p className="text-sm text-sage">Settings saved.</p>}
    </div>
  );
}
