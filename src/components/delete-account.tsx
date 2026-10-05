"use client";

import { useActionState } from "react";
import { deleteAccount } from "@/actions/account";
import { Button, Field, inputClass } from "@/components/ui";

export function DeleteAccount({ email }: { email: string | null }) {
  const [state, action, pending] = useActionState(deleteAccount, {});
  return (
    <details className="rounded-md border border-rule p-4">
      <summary className="cursor-pointer text-sm font-bold text-rose">Delete my account</summary>
      <form
        action={action}
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          if (!confirm("Delete your account and all your data? This can't be undone.")) e.preventDefault();
        }}
      >
        <p className="max-w-prose text-sm text-muted">
          This permanently deletes your exams, topics, plans, progress and every file you uploaded. It can't be undone.
        </p>
        <Field label={email ? `Type ${email} to confirm` : "Type DELETE to confirm"} htmlFor="confirm">
          <input id="confirm" name="confirm" autoComplete="off" required className={inputClass} />
        </Field>
        {state.error && (
          <p role="alert" className="rounded-md bg-rose-soft px-3 py-2 text-sm text-rose">
            {state.error}
          </p>
        )}
        <Button type="submit" variant="danger" disabled={pending} className="border border-rose">
          {pending ? "Deleting…" : "Delete everything"}
        </Button>
      </form>
    </details>
  );
}
