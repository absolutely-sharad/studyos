"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { deleteStoredFile } from "@/lib/storage";

const categorySchema = z.enum(["SYLLABUS", "NOTES", "TEXTBOOK", "PYQ", "QUESTION_BANK", "REVISION_NOTES", "OTHER"]);

export async function setDocumentCategory(documentId: string, category: string) {
  const user = await requireUser();
  const parsed = categorySchema.parse(category);
  await db.document.updateMany({ where: { id: documentId, userId: user.id }, data: { category: parsed, categorySource: "USER" } });
  revalidatePath("/setup");
}

export async function deleteDocument(documentId: string) {
  const user = await requireUser();
  const doc = await db.document.findFirst({ where: { id: documentId, userId: user.id } });
  if (!doc) return;
  await db.document.delete({ where: { id: doc.id } });
  await deleteStoredFile(doc.storageKey).catch(() => undefined);
  revalidatePath("/setup");
}
