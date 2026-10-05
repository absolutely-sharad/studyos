import Link from "next/link";
import { brand } from "@/lib/config";

/** Mark: a ruled sheet with a red margin line. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="2" width="28" height="28" rx="6" fill="#1e2b4a" />
      <path d="M8 11h17M8 16h17M8 21h12" stroke="#e6edf8" strokeWidth="2" strokeLinecap="round" />
      <path d="M11.5 6v20" stroke="#d4504a" strokeWidth="1.6" />
    </svg>
  );
}

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 rounded-md">
      <BrandMark />
      <span className="font-display text-xl font-bold tracking-tight">{brand.appName}</span>
    </Link>
  );
}
