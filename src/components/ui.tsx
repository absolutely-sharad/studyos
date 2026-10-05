import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-ink-soft disabled:bg-muted",
  secondary: "bg-sheet text-ink border border-rule hover:border-ink-soft",
  ghost: "text-ink-soft hover:bg-sky-soft",
  danger: "text-rose hover:bg-rose-soft",
  accent: "bg-marigold text-ink hover:brightness-95",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-[15px]",
  lg: "h-12 px-6 text-base",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-md font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    variants[variant],
    sizes[size],
    extra,
  );
}

export function Button({
  variant,
  size,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

export function ButtonLink({
  href,
  variant,
  size,
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; variant?: Variant; size?: Size }) {
  return <Link href={href} {...props} className={buttonClass(variant, size, className)} />;
}

/** Border, colour and focus only. Callers add width, height, padding and text size, so classes never conflict. */
export const inputBase =
  "rounded-md border border-rule bg-sheet text-ink placeholder:text-muted/70 focus:border-ink-soft focus:outline-none";
export const inputClass = `${inputBase} w-full px-3 py-2 text-[15px]`;

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-bold text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-lg border border-rule bg-sheet p-5", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-baseline justify-between gap-3">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export type Tone = "neutral" | "good" | "warn" | "risk" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-paper text-muted",
  good: "bg-sage-soft text-sage",
  warn: "bg-marigold-soft text-[#8a5a12]",
  risk: "bg-rose-soft text-rose",
  info: "bg-sky-soft text-ink-soft",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold", tones[tone])}>{children}</span>;
}

export function Meter({ value, tone = "info", label }: { value: number; tone?: Tone; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const fill = { neutral: "bg-muted", good: "bg-sage", warn: "bg-marigold", risk: "bg-rose", info: "bg-ink-soft" }[tone];
  return (
    <div role="meter" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-1.5 w-full rounded-full bg-rule">
      <div className={cx("h-full rounded-full", fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  const border = { neutral: "border-rule", good: "border-sage", warn: "border-marigold", risk: "border-rose", info: "border-ink-soft" }[tone];
  return <div className={cx("rounded-md border-l-4 bg-sheet px-4 py-3 text-[15px]", border)}>{children}</div>;
}
