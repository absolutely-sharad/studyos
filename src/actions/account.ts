"use server";

import { signOut } from "@/auth";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { hit, RULES, waitMessage } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import { deleteStoredFile } from "@/lib/storage";

export interface DeleteAccountState {
  error?: string;
}

/**
 * Permanently erases the signed-in student's account: profile, exams, topics, plans, progress and
 * every uploaded file. The student confirms by typing their email (or DELETE if the account has none).
 */
export async function deleteAccount(_: DeleteAccountState, form: FormData): Promise<DeleteAccountState> {
  const user = await requireUser();
  const verdict = await hit(RULES.deleteAccount, user.id);
  if (!verdict.ok) return { error: waitMessage(verdict) };

  const expected = (user.email ?? "DELETE").toLowerCase();
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== expected)
    return { error: user.email ? "Type your email address exactly as shown to confirm." : "Type DELETE to confirm." };

  const files = await db.document.findMany({ where: { userId: user.id }, select: { storageKey: true } });
  // Every table that holds the student's data cascades from the user row, so one delete clears the database.
  await db.user.delete({ where: { id: user.id } });
  // Files go after the rows: if one fails to delete it is logged for cleanup, but the account is already gone.
  const failed = (await Promise.all(files.map((f) => deleteStoredFile(f.storageKey).then(() => null, (err) => ({ key: f.storageKey, err }))))).filter(
    (r) => r !== null,
  );
  for (const f of failed) log.error("file from a deleted account could not be removed", f.err, { storageKey: f.key });
  log.info("account deleted", { userId: user.id, files: files.length, filesNotRemoved: failed.length });

  await signOut({ redirectTo: "/" });
  return {};
}
