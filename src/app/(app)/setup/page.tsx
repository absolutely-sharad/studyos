import type { Metadata } from "next";
import Link from "next/link";
import { BuildTopicMap } from "@/components/build-topic-map";
import { DocumentManager } from "@/components/document-manager";
import { ReplanPanel } from "@/components/replan-panel";
import { Panel, buttonClass } from "@/components/ui";
import { db } from "@/lib/db";
import { toDocumentView } from "@/lib/documents/serialize";
import { requireExam } from "@/lib/session";
import { aiEnabled } from "@/lib/syllabus/llm";

export const metadata: Metadata = { title: "Materials" };

export default async function SetupPage() {
  const { user, exam } = await requireExam();
  const [docs, topicCount] = await Promise.all([
    db.document.findMany({ where: { examId: exam.id, userId: user.id }, orderBy: { createdAt: "asc" } }),
    db.topic.count({ where: { examId: exam.id } }),
  ]);
  const confirmed = Boolean(exam.syllabusConfirmedAt);
  const hasSyllabusFile = docs.some((d) => d.category === "SYLLABUS" && d.status === "READY");
  const hasPyq = docs.some((d) => (d.category === "PYQ" || d.category === "QUESTION_BANK") && d.status === "READY");

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold">{confirmed ? "Materials" : "Add your materials"}</h1>
        <p className="mt-2 max-w-prose text-muted">
          {confirmed
            ? "Upload new notes or previous-year papers any time. Papers change which topics count as high priority."
            : "Start with your syllabus. Previous-year papers are optional, but they tell StudyOS which topics come up most."}
        </p>
      </header>

      {!confirmed && topicCount > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-ink bg-sky-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Your topic map has {topicCount} topics waiting for review.
          </p>
          <Link href="/setup/review" className={buttonClass("primary", "md")}>
            Review topics
          </Link>
        </div>
      )}

      <Panel title="Files">
        <DocumentManager initial={docs.map(toDocumentView)} />
      </Panel>

      {confirmed && (
        <ReplanPanel
          tone="info"
          reason="New materials"
          buttonLabel="Preview updated plan"
          intro={
            hasPyq
              ? "Added new papers or notes? Rebuild your plan so priorities reflect them. Nothing changes until you confirm."
              : "Upload a previous-year paper, then rebuild your plan to rank topics by how often they're asked."
          }
        />
      )}

      <Panel title={confirmed ? "Rebuild topic map" : "Build your topic map"}>
        <p className="mb-4 max-w-prose text-muted">
          {aiEnabled()
            ? "StudyOS reads your syllabus files and finds subjects, chapters, topics and prerequisites. You'll review everything before a plan is made."
            : "StudyOS reads your syllabus files with its built-in parser and lists every topic it finds. You'll review everything before a plan is made."}
        </p>
        <BuildTopicMap hasSyllabusFile={hasSyllabusFile} rebuilding={topicCount > 0} aiEnabled={aiEnabled()} />
      </Panel>
    </div>
  );
}
