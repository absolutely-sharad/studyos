import { cx } from "@/components/ui";

export const STATUS_META: Record<string, { label: string; dot: string }> = {
  COMPLETED: { label: "Done", dot: "bg-sage" },
  IN_PROGRESS: { label: "In progress", dot: "bg-ink-soft" },
  NEEDS_REVISION: { label: "Needs work", dot: "bg-rose" },
  NOT_STARTED: { label: "Not started", dot: "border-2 border-muted/50 bg-sheet" },
};

export function StatusDot({ status, className }: { status: string; className?: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.NOT_STARTED;
  return <span title={meta.label} className={cx("inline-block size-2.5 shrink-0 rounded-full", meta.dot, className)} />;
}
