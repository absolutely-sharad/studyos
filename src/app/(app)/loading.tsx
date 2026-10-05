/** Shown while a signed-in page loads its data, so navigation never looks frozen. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading…</span>
      <div className="h-9 w-56 animate-pulse rounded-md bg-rule" />
      <div className="h-24 animate-pulse rounded-lg bg-rule/70" />
      <div className="space-y-3">
        <div className="h-14 animate-pulse rounded-lg bg-rule/70" />
        <div className="h-14 animate-pulse rounded-lg bg-rule/70" />
        <div className="h-14 animate-pulse rounded-lg bg-rule/70" />
      </div>
    </div>
  );
}
