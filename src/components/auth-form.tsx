"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthState } from "@/app/(auth)/actions";
import { Button, Field, inputClass } from "@/components/ui";

export function AuthForm({
  mode,
  action,
}: {
  mode: "login" | "signup";
  action: (state: AuthState, form: FormData) => Promise<AuthState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4">
      {mode === "signup" && (
        <Field label="Name" htmlFor="name">
          <input id="name" name="name" autoComplete="name" required className={inputClass} />
        </Field>
      )}
      <Field label="Email" htmlFor="email">
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} className={inputClass} />
      </Field>
      <Field label="Password" htmlFor="password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
          minLength={mode === "signup" ? 8 : undefined}
          className={inputClass}
        />
      </Field>
      {state.error && (
        <p role="alert" className="rounded-md bg-rose-soft px-3 py-2 text-sm text-rose">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? (mode === "signup" ? "Creating account…" : "Signing in…") : mode === "signup" ? "Create account" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted">
        {mode === "signup" ? (
          <>
            Already have an account? <Link href="/login" className="font-bold text-ink underline-offset-4 hover:underline">Sign in</Link>
          </>
        ) : (
          <>
            New to StudyOS? <Link href="/signup" className="font-bold text-ink underline-offset-4 hover:underline">Create an account</Link>
          </>
        )}
      </p>
    </form>
  );
}
