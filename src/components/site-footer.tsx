import Link from "next/link";
import { brand } from "@/lib/config";

export function DeveloperLinks({ className }: { className?: string }) {
  return (
    <span className={className}>
      <a href={brand.githubUrl} className="underline-offset-4 hover:underline" rel="noopener" target="_blank">
        GitHub
      </a>
      {brand.linkedinUrl && (
        <>
          {" · "}
          <a href={brand.linkedinUrl} className="underline-offset-4 hover:underline" rel="noopener" target="_blank">
            LinkedIn
          </a>
        </>
      )}
    </span>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-8 text-sm text-muted sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="font-display text-base font-semibold text-ink">{brand.appName}</p>
          <p>{brand.tagline}</p>
          <p>
            Built by {brand.developer}, {brand.company}
          </p>
        </div>
        <div className="space-y-1 sm:text-right">
          <p>
            <Link href="/about" className="underline-offset-4 hover:underline">About</Link>
            {"  "}
            <Link href="/credits" className="ml-3 underline-offset-4 hover:underline">Credits</Link>
            <DeveloperLinks className="ml-3" />
          </p>
          <p>© 2026 {brand.company}. {brand.appName} — AI-powered adaptive learning.</p>
        </div>
      </div>
    </footer>
  );
}
