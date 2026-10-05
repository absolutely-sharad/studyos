import type { Metadata } from "next";
import { Wordmark } from "@/components/brand";
import { requireUser } from "@/lib/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your exam" };

export default async function OnboardingPage() {
  const user = await requireUser();
  return (
    <div className="min-h-dvh">
      <header className="mx-auto max-w-2xl px-5 pt-8">
        <Wordmark href="/dashboard" />
      </header>
      <main className="mx-auto max-w-2xl px-5 py-10">
        <OnboardingForm firstName={user.name?.split(" ")[0] ?? null} />
      </main>
    </div>
  );
}
