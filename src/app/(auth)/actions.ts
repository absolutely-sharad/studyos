"use server";

import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { z } from "zod";
import { ServerBusy, signIn, signOut, TooManyAttempts } from "@/auth";
import { db } from "@/lib/db";
import { PrismaClientKnownRequestError } from "@/generated/prisma/internal/prismaNamespace";
import { hashPassword, MAX_PASSWORD_BYTES, PasswordBusyError } from "@/lib/password";
import { clientIp, hit, RULES, waitMessage } from "@/lib/rate-limit";

export interface AuthState {
  error?: string;
  /** Echoed back because React clears uncontrolled fields after every form action. */
  email?: string;
  name?: string;
}

const BUSY = "We're busy right now. Wait a few seconds and try again.";

const signupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  password: z
    .string()
    .min(8, "Use at least 8 characters for your password.")
    .refine((p) => Buffer.byteLength(p) <= MAX_PASSWORD_BYTES, `Use a password of ${MAX_PASSWORD_BYTES} bytes or fewer.`),
});

async function signInWithPassword(email: string, password: string): Promise<AuthState> {
  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
    return {};
  } catch (err) {
    const code = err instanceof AuthError ? (err as { code?: string }).code : undefined;
    if (err instanceof ServerBusy || code === "busy") return { error: BUSY, email };
    if (err instanceof TooManyAttempts || code === "rate_limited")
      return { error: "Too many sign-in attempts. Wait a few minutes and try again.", email };
    if (err instanceof AuthError) return { error: "That email and password don't match an account.", email };
    throw err; // the success redirect is thrown, too
  }
}

export async function signupAction(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(form));
  const email = String(form.get("email") ?? "");
  const name = String(form.get("name") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, email, name };

  const verdict = await hit(RULES.signupIp, clientIp(await headers()));
  if (!verdict.ok) return { error: waitMessage(verdict), email, name };

  const existing = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) return { error: "An account with this email already exists. Sign in instead.", email, name };

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(parsed.data.password);
  } catch (err) {
    if (err instanceof PasswordBusyError) return { error: BUSY, email, name };
    throw err;
  }

  try {
    await db.user.create({ data: { name: parsed.data.name, email: parsed.data.email, passwordHash } });
  } catch (err) {
    // Two sign-ups for the same address can both pass the check above; the unique index decides.
    if (err instanceof PrismaClientKnownRequestError && err.code === "P2002")
      return { error: "An account with this email already exists. Sign in instead.", email, name };
    throw err;
  }
  return signInWithPassword(parsed.data.email, parsed.data.password);
}

export async function loginAction(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };
  return signInWithPassword(email, password);
}

export async function googleAction() {
  await signIn("google", { redirectTo: "/dashboard" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
