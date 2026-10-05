import type { Metadata } from "next";
import { Wordmark } from "@/components/brand";
import { DeveloperLinks, SiteFooter } from "@/components/site-footer";
import { brand } from "@/lib/config";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto w-full max-w-3xl px-5 py-5">
        <Wordmark />
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-10 px-5 py-10">
        <section>
          <h1 className="text-4xl font-bold">About {brand.appName}</h1>
          <p className="mt-4 max-w-prose text-lg text-ink-soft">
            {brand.appName} is an AI-powered adaptive learning system designed to transform unstructured academic material into a personalized,
            continuously optimized study plan.
          </p>
          <p className="mt-4 max-w-prose text-ink-soft">
            Students rarely lack resources. They have too many, and no system that turns them into a realistic plan. {brand.appName} reads your
            syllabus, notes and previous-year papers, orders topics by prerequisites and importance, fits them into the time you actually have, and
            rebuilds the plan as your progress changes.
          </p>
        </section>
        <section>
          <h2 className="text-2xl font-bold">Built by</h2>
          <p className="mt-3 text-lg font-bold">{brand.developer}</p>
          <p className="text-ink-soft">Founder / Builder, {brand.company}</p>
          <DeveloperLinks className="mt-3 block" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
