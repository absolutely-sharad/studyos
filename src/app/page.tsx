import Link from "next/link";
import { auth } from "@/auth";
import { Wordmark } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";
import { ButtonLink } from "@/components/ui";

const SAMPLE = [
  { time: "1h", title: "Study: Graph traversal (BFS, DFS)", tag: "High priority" },
  { time: "45m", title: "Practice: Graph traversal", tag: null },
  { time: "20m", title: "Revise: Binary search trees", tag: "Revision" },
  { time: "30m", title: "Revise: Process scheduling", tag: "Revision" },
];

const STEPS = [
  {
    title: "Add your syllabus and papers",
    body: "Upload the syllabus PDF, your notes and previous-year papers, or paste the syllabus as text.",
  },
  {
    title: "Confirm the topic map",
    body: "StudyOS lists subjects, topics and prerequisites. You fix anything that's off and tell it your level.",
  },
  {
    title: "Study, check in, and let it adapt",
    body: "Each day has a short list. Mark sessions done or skipped, and the plan rebalances without overloading you.",
  },
];

export default async function Home() {
  const signedIn = Boolean((await auth())?.user);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5">
        <Wordmark />
        <nav className="flex items-center gap-2">
          {signedIn ? (
            <ButtonLink href="/dashboard" size="sm">Open StudyOS</ButtonLink>
          ) : (
            <>
              <Link href="/login" className="px-3 text-[15px] font-bold text-ink-soft hover:text-ink">
                Sign in
              </Link>
              <ButtonLink href="/signup" size="sm">Create your plan</ButtonLink>
            </>
          )}
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid max-w-5xl gap-12 px-5 pb-20 pt-12 lg:grid-cols-[1.35fr_1fr] lg:items-center lg:pt-20">
          <div>
            <h1 className="font-display text-[2.4rem] font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.4rem]">
              “Mujhe exactly kya padhna hai, kis order mein, aur exam tak kaise complete karna hai?”
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-soft">
              StudyOS answers that every morning. It turns your syllabus, notes and previous-year papers into a plan for today, this week and every day
              until the exam, and adjusts it when a day doesn't go to plan.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href={signedIn ? "/dashboard" : "/signup"} size="lg">
                {signedIn ? "Open your plan" : "Create your plan"}
              </ButtonLink>
              <ButtonLink href="#how" variant="secondary" size="lg">
                See how it works
              </ButtonLink>
            </div>
          </div>

          <figure aria-label="Example of a daily plan" className="notebook overflow-hidden rounded-lg border border-rule shadow-[0_18px_40px_-24px_rgba(30,43,74,0.45)]">
            <div className="grid grid-cols-[4.75rem_1fr] border-b-2 border-rule">
              <span />
              <figcaption className="py-4 pl-5 pr-4">
                <span className="block font-display text-lg font-semibold">Monday, 12 Oct</span>
                <span className="text-sm text-muted">2h 35m planned, 38 days to GATE</span>
              </figcaption>
            </div>
            <ul>
              {SAMPLE.map((s) => (
                <li key={s.title} className="grid grid-cols-[4.75rem_1fr] border-b border-rule last:border-b-0">
                  <span className="px-3 py-3.5 text-right font-display font-semibold">{s.time}</span>
                  <span className="py-3.5 pl-5 pr-4">
                    <span className="block font-bold">{s.title}</span>
                    {s.tag && <span className={`text-xs font-bold ${s.tag === "High priority" ? "text-marigold" : "text-ink-soft"}`}>{s.tag}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </figure>
        </section>

        <section id="how" className="border-y border-rule bg-sheet">
          <div className="mx-auto max-w-5xl px-5 py-16">
            <h2 className="max-w-xl text-3xl font-bold">From a pile of PDFs to a plan you can follow</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="border-l-2 border-margin pl-5">
                  <span className="font-display text-sm font-semibold text-margin">Step {i + 1}</span>
                  <h3 className="mt-1 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-ink-soft">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto grid max-w-5xl gap-10 px-5 py-16 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold">Prerequisites come first</h2>
            <p className="mt-3 text-ink-soft">
              Topics are ordered so you never meet binary search trees before binary search. A foundation needed by an urgent topic is pulled forward with it.
            </p>
          </div>
          <div>
            <h2 className="text-2xl font-bold">Every priority has a reason</h2>
            <p className="mt-3 text-ink-soft">
              “High priority because it appears in 6 previous-year questions and your mastery is low.” You always see why a topic is near the top.
            </p>
          </div>
          <div>
            <h2 className="text-2xl font-bold">Falling behind is expected</h2>
            <p className="mt-3 text-ink-soft">
              Miss three days and StudyOS rebuilds the rest of the plan within your daily limit, keeps revision, and shows you the change before applying it.
            </p>
          </div>
          <div>
            <h2 className="text-2xl font-bold">Your materials, cited</h2>
            <p className="mt-3 text-ink-soft">Each topic links to the files and pages where it appears in your own notes and papers.</p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
