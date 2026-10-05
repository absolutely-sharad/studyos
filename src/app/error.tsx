"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The server has already logged the real error; this is only for the browser console.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-5">
      <h1 className="text-3xl font-bold">Something went wrong</h1>
      <p className="text-muted">Your plan and files are safe. This was a problem on our side, so trying again usually works.</p>
      {error.digest && <p className="text-sm text-muted">Reference: {error.digest}</p>}
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <ButtonLink href="/dashboard" variant="secondary">
          Go to today
        </ButtonLink>
      </div>
    </main>
  );
}
