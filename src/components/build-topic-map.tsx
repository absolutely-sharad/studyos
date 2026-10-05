"use client";

import { useActionState } from "react";
import { buildTopicMap } from "@/actions/syllabus";
import { Button, inputClass } from "@/components/ui";

export function BuildTopicMap({ hasSyllabusFile, rebuilding, aiEnabled }: { hasSyllabusFile: boolean; rebuilding: boolean; aiEnabled: boolean }) {
  const [state, action, pending] = useActionState(buildTopicMap, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block space-y-1.5">
        <span className="block text-sm font-bold">{hasSyllabusFile ? "Anything to add? (optional)" : "Or paste your syllabus"}</span>
        <textarea
          name="pasted"
          rows={6}
          className={inputClass}
          placeholder={"Unit 1: Arrays, Linked lists, Stacks, Queues\nUnit 2: Trees, Binary search trees, Heaps\n…"}
        />
      </label>
      {rebuilding && (
        <p className="text-sm text-rose">Rebuilding replaces your current topics and plan. Completed work won't carry over.</p>
      )}
      {state.error && (
        <p role="alert" className="rounded-md bg-rose-soft px-3 py-2 text-sm text-rose">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} variant={rebuilding ? "secondary" : "primary"}>
          {pending ? "Reading your syllabus…" : rebuilding ? "Rebuild topic map" : "Build my topic map"}
        </Button>
        {pending && <span className="text-sm text-muted">{aiEnabled ? "This usually takes 20–60 seconds." : "This takes a few seconds."}</span>}
      </div>
    </form>
  );
}
