import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-5">
      <h1 className="text-3xl font-bold">This page doesn't exist</h1>
      <p className="text-muted">It may have been removed, or the link is wrong.</p>
      <ButtonLink href="/dashboard" className="self-start">Go to today</ButtonLink>
    </main>
  );
}
