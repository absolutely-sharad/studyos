import type { Metadata } from "next";
import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { SettingsForm } from "@/components/settings-form";
import { DeleteAccount } from "@/components/delete-account";
import { Button, Panel } from "@/components/ui";
import { brand } from "@/lib/config";
import { toDateKey } from "@/lib/dates";
import { requireExam, weeklyMinutesOf } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user, exam } = await requireExam();
  const weekly = weeklyMinutesOf(exam);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>
      <Panel title="Exam and study time">
        <SettingsForm
          canReplan={Boolean(exam.syllabusConfirmedAt)}
          initial={{
            name: exam.name,
            examDate: toDateKey(exam.examDate),
            targetScore: exam.targetScore ?? "",
            hours: Array.from({ length: 7 }, (_, d) => weekly[d] / 60),
            bufferPercent: exam.bufferPercent,
            unavailable: exam.unavailableDates,
          }}
        />
      </Panel>

      <Panel title="Account">
        <p className="mb-4 text-sm text-muted">Signed in as {user.email ?? user.name}.</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/onboarding" className="inline-flex h-8 items-center rounded-md border border-rule px-3 text-sm font-bold hover:border-ink-soft">
            Start a new exam
          </Link>
          <form action={signOutAction}>
            <Button size="sm" variant="ghost">
              Sign out
            </Button>
          </form>
        </div>
        <div className="mt-6">
          <DeleteAccount email={user.email} />
        </div>
      </Panel>

      <Panel title={`About ${brand.appName}`}>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Version</dt>
          <dd>v{brand.version}</dd>
          <dt className="text-muted">Built by</dt>
          <dd>{brand.developer}</dd>
          <dt className="text-muted">Company</dt>
          <dd>{brand.company}</dd>
          <dt className="text-muted">GitHub</dt>
          <dd>
            <a href={brand.githubUrl} target="_blank" rel="noopener" className="underline-offset-4 hover:underline">
              View source
            </a>
          </dd>
          {brand.linkedinUrl && (
            <>
              <dt className="text-muted">LinkedIn</dt>
              <dd>
                <a href={brand.linkedinUrl} target="_blank" rel="noopener" className="underline-offset-4 hover:underline">
                  Connect with the builder
                </a>
              </dd>
            </>
          )}
        </dl>
      </Panel>
    </div>
  );
}
