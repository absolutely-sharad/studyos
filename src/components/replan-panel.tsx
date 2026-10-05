"use client";

import { useState, useTransition } from "react";
import { applyReplanAction, previewReplanAction } from "@/actions/plan";
import { Button, Notice } from "@/components/ui";
import type { PlanSummary } from "@/lib/planner/service";

export function ReplanPanel({
  intro,
  reason,
  buttonLabel = "Show me the new plan",
  tone = "warn",
}: {
  intro: React.ReactNode;
  reason: string;
  buttonLabel?: string;
  tone?: "warn" | "info";
}) {
  const [preview, setPreview] = useState<PlanSummary | null>(null);
  const [done, setDone] = useState<PlanSummary | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      try {
        await fn();
      } catch {
        setError("That didn't work. Try again in a moment.");
      }
    });

  if (done) return <Notice tone="good">{done.text}</Notice>;

  return (
    <Notice tone={tone}>
      <div className="space-y-3">
        {!preview ? (
          <>
            <div>{intro}</div>
            <Button size="sm" disabled={pending} onClick={() => run(async () => setPreview(await previewReplanAction()))}>
              {pending ? "Working it out…" : buttonLabel}
            </Button>
          </>
        ) : (
          <>
            <p>{preview.text}</p>
            {preview.warnings.filter((w) => !preview.text.includes(w)).map((w) => (
              <p key={w} className="text-sm text-muted">{w}</p>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={pending} onClick={() => run(async () => setDone(await applyReplanAction(reason)))}>
                {pending ? "Updating…" : "Apply new plan"}
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setPreview(null)}>
                Keep current plan
              </Button>
            </div>
          </>
        )}
        {error && <p className="text-sm text-rose">{error}</p>}
      </div>
    </Notice>
  );
}
