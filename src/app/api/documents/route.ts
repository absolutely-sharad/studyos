import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { guessCategory } from "@/lib/documents/categorize";
import { db } from "@/lib/db";
import { detectKind } from "@/lib/documents/extract";
import { processDocument } from "@/lib/documents/process";
import { CATEGORY_LABELS, toDocumentView } from "@/lib/documents/serialize";
import { getActiveExam } from "@/lib/session";
import { saveFile } from "@/lib/storage";
import type { DocumentCategory } from "@/generated/prisma/enums";

export const maxDuration = 60;

const MAX_FILES_PER_EXAM = 100;
const IN_PIPELINE = ["UPLOADED", "EXTRACTING", "CHUNKING"];
const STALE_MS = 5 * 60 * 1000;

async function context() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const exam = await getActiveExam(session.user.id);
  return exam ? { userId: session.user.id, exam } : null;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const ctx = await context();
  if (!ctx) return NextResponse.json({ documents: [] });
  const docs = await db.document.findMany({ where: { examId: ctx.exam.id, userId: ctx.userId }, orderBy: { createdAt: "asc" } });

  // Recovery: files left mid-pipeline by a server restart are picked up again.
  const stale = docs.filter((d) => IN_PIPELINE.includes(d.status) && Date.now() - d.updatedAt.getTime() > STALE_MS);
  if (stale.length > 0) {
    await db.document.updateMany({ where: { id: { in: stale.map((d) => d.id) } }, data: { status: "UPLOADED" } });
    after(() => Promise.all(stale.map((d) => processDocument(d.id))));
  }
  return NextResponse.json({ documents: docs.map(toDocumentView) });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sign in and set up your exam first." }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  const requested = String(form.get("category") ?? "AUTO");
  const category = requested === "AUTO" ? guessCategory(file.name) : requested;
  const count = await db.document.count({ where: { examId: ctx.exam.id } });
  if (count >= MAX_FILES_PER_EXAM)
    return NextResponse.json({ error: `You can keep up to ${MAX_FILES_PER_EXAM} files per exam. Remove some to add more.` }, { status: 400 });
  if (!(category in CATEGORY_LABELS)) return NextResponse.json({ error: "Pick a category for this file." }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: `${file.name} is empty.` }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES)
    return NextResponse.json({ error: `${file.name} is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` }, { status: 400 });
  const kind = detectKind(file.name, file.type);
  if (!kind) return NextResponse.json({ error: `${file.name} isn't a PDF, DOCX or TXT file.` }, { status: 400 });

  const ext = { pdf: "pdf", docx: "docx", text: "txt" }[kind];
  const storageKey = `${ctx.userId}/${randomUUID()}.${ext}`;
  await saveFile(storageKey, Buffer.from(await file.arrayBuffer()));

  const doc = await db.document.create({
    data: {
      examId: ctx.exam.id,
      userId: ctx.userId,
      filename: file.name.slice(0, 200),
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      category: category as DocumentCategory,
      categorySource: requested === "AUTO" ? "NAME" : "USER",
      storageKey,
    },
  });

  // Extraction runs after the response is sent; the client polls GET for real status.
  after(() => processDocument(doc.id));
  return NextResponse.json({ document: toDocumentView(doc) }, { status: 201 });
}
