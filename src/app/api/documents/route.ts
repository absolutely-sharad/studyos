import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { guessCategory } from "@/lib/documents/categorize";
import { db } from "@/lib/db";
import { detectKind } from "@/lib/documents/extract";
import { processDocument } from "@/lib/documents/process";
import { CATEGORY_LABELS, toDocumentView } from "@/lib/documents/serialize";
import { matchesKind, SAFE_MIME } from "@/lib/documents/validate";
import { log } from "@/lib/log";
import { hit, RULES, waitMessage } from "@/lib/rate-limit";
import { getActiveExam } from "@/lib/session";
import { deleteStoredFile, saveFile } from "@/lib/storage";
import type { DocumentCategory } from "@/generated/prisma/enums";

export const maxDuration = 60;

const MAX_FILES_PER_EXAM = 100;
const IN_PIPELINE = ["UPLOADED", "EXTRACTING", "CHUNKING"];
const STALE_MS = 5 * 60 * 1000;
// Multipart framing and the other form fields add a little on top of the file itself.
const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 256 * 1024;

const fail = (error: string, status: number, headers?: HeadersInit) => NextResponse.json({ error }, { status, headers });

async function context() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const exam = await getActiveExam(session.user.id);
  return exam ? { userId: session.user.id, exam } : null;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return fail("Sign in first.", 401);
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
  if (!ctx) return fail("Sign in and set up your exam first.", 401);

  const verdict = await hit(RULES.upload, ctx.userId);
  if (!verdict.ok) return fail(waitMessage(verdict), 429, { "Retry-After": String(verdict.retryAfterSec) });

  // Refuse oversized bodies before buffering them into memory. (Clients that don't send a length are
  // still caught by the size check below.)
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    return fail(`That file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("The upload was incomplete. Try again.", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail("Choose a file to upload.", 400);
  const requested = String(form.get("category") ?? "AUTO");
  const category = requested === "AUTO" ? guessCategory(file.name) : requested;
  const count = await db.document.count({ where: { examId: ctx.exam.id } });
  if (count >= MAX_FILES_PER_EXAM) return fail(`You can keep up to ${MAX_FILES_PER_EXAM} files per exam. Remove some to add more.`, 400);
  if (!(category in CATEGORY_LABELS)) return fail("Pick a category for this file.", 400);
  if (file.size === 0) return fail(`${file.name} is empty.`, 400);
  if (file.size > MAX_UPLOAD_BYTES) return fail(`${file.name} is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, 413);
  // Trust the extension, not the browser's Content-Type, then confirm the bytes agree.
  const kind = detectKind(file.name, "");
  if (!kind) return fail(`${file.name} isn't a PDF, DOCX or TXT file.`, 400);
  const data = Buffer.from(await file.arrayBuffer());
  if (!matchesKind(data, kind)) return fail(`${file.name} doesn't look like a real ${kind === "text" ? "text" : kind.toUpperCase()} file. Check it opens on your device and try again.`, 400);

  const ext = { pdf: "pdf", docx: "docx", text: "txt" }[kind];
  const storageKey = `${ctx.userId}/${randomUUID()}.${ext}`;
  await saveFile(storageKey, data, SAFE_MIME[kind]);

  let doc;
  try {
    doc = await db.document.create({
      data: {
        examId: ctx.exam.id,
        userId: ctx.userId,
        filename: file.name.slice(0, 200),
        mimeType: SAFE_MIME[kind],
        sizeBytes: file.size,
        category: category as DocumentCategory,
        categorySource: requested === "AUTO" ? "NAME" : "USER",
        storageKey,
      },
    });
  } catch (err) {
    // Don't leave an unreferenced file behind when the database write fails.
    await deleteStoredFile(storageKey).catch((e) => log.error("orphaned upload could not be removed", e, { storageKey }));
    throw err;
  }

  // Extraction runs after the response is sent; the client polls GET for real status.
  after(() => processDocument(doc.id));
  return NextResponse.json({ document: toDocumentView(doc) }, { status: 201 });
}
