"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const LINKS = [
  { href: "/dashboard", label: "Today", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/plan", label: "Plan", icon: "M5 4h14v16H5zM5 9h14M9 4v5" },
  { href: "/syllabus", label: "Syllabus", icon: "M6 4v16M6 8h8M6 14h12M14 8v0" },
  { href: "/setup", label: "Materials", icon: "M7 3h7l4 4v14H7zM14 3v4h4" },
  { href: "/settings", label: "Settings", icon: "M12 9a3 3 0 100 6 3 3 0 000-6zM4 12h2M18 12h2M12 4v2M12 18v2" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function AppNav({ variant }: { variant: "side" | "bottom" }) {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`) || (href === "/syllabus" && pathname.startsWith("/topics"));

  if (variant === "bottom") {
    return (
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-sheet pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="grid grid-cols-5">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active(l.href) ? "page" : undefined}
                className={cx("flex flex-col items-center gap-0.5 py-2 text-xs", active(l.href) ? "font-bold text-ink" : "text-muted")}
              >
                <Icon d={l.icon} />
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  }
  return (
    <nav aria-label="Main">
      <ul className="space-y-1">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={active(l.href) ? "page" : undefined}
              className={cx(
                "flex items-center gap-3 rounded-md px-3 py-2 text-[15px]",
                active(l.href) ? "bg-sky-soft font-bold text-ink" : "text-ink-soft hover:bg-paper",
              )}
            >
              <Icon d={l.icon} />
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
