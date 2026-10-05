import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { detectKind } from "@/lib/documents/extract";
import { contentDisposition, INLINE_KINDS, SAFE_MIME } from "@/lib/documents/validate";
import { log } from "@/lib/log";
import { readStoredFile, StorageNotFoundError } from "@/lib/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const doc = await db.document.findFirst({ where: { id, userId: session.user.id } });
  if (!doc) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // The type comes from the file name's extension, which we validated at upload, and never from
  // the stored Content-Type (older rows kept whatever the browser sent).
  const kind = detectKind(doc.filename, "");
  if (!kind) return NextResponse.json({ error: "This file type can't be shown." }, { status: 415 });

  try {
    const data = await readStoredFile(doc.storageKey);
    const inline = INLINE_KINDS.has(kind);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": SAFE_MIME[kind],
        "Content-Length": String(data.byteLength),
        "Content-Disposition": contentDisposition(doc.filename, inline ? "inline" : "attachment"),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // Belt and braces: even if a browser rendered this as a page, nothing in it could run or load.
        // (Skipped for PDFs: Chrome's built-in viewer refuses to open a sandboxed PDF.)
        ...(kind !== "pdf" && { "Content-Security-Policy": "default-src 'none'; sandbox" }),
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (err) {
    if (err instanceof StorageNotFoundError)
      return NextResponse.json({ error: "The file is no longer in storage. Upload it again." }, { status: 410 });
    log.error("could not read stored document", err, { documentId: doc.id });
    return NextResponse.json({ error: "We couldn't load this file right now. Try again in a moment." }, { status: 502 });
  }
}
