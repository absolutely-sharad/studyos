import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { readStoredFile } from "@/lib/storage";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;
  const doc = await db.document.findFirst({ where: { id, userId: session.user.id } });
  if (!doc) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    const data = await readStoredFile(doc.storageKey);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": doc.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.filename)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "The file is no longer in storage. Upload it again." }, { status: 410 });
  }
}
