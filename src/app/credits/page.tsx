import type { Metadata } from "next";
import { Wordmark } from "@/components/brand";
import { DeveloperLinks, SiteFooter } from "@/components/site-footer";
import { brand } from "@/lib/config";

export const metadata: Metadata = { title: "Credits" };

const AREAS = ["AI architecture", "Full-stack engineering", "RAG pipeline", "Adaptive planning", "Document intelligence", "Product design"];

export default function CreditsPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto w-full max-w-3xl px-5 py-5">
        <Wordmark />
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-5 py-10">
        <h1 className="text-4xl font-bold">Credits</h1>
        <section>
          <h2 className="text-sm font-bold text-muted">Designed and developed by</h2>
          <p className="mt-1 text-2xl font-bold">{brand.developer}</p>
          <p className="text-ink-soft">{brand.company}</p>
          <DeveloperLinks className="mt-2 block" />
        </section>
        <section>
          <h2 className="text-sm font-bold text-muted">Engineering</h2>
          <ul className="mt-2 space-y-1">
            {AREAS.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="text-sm font-bold text-muted">Third-party technology</h2>
          <p className="mt-2 max-w-prose text-ink-soft">
            {brand.appName} uses open-source software including Next.js, React, Prisma, PostgreSQL and Auth.js, and can use third-party AI models for
            syllabus analysis. Those projects and models belong to their respective owners.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
