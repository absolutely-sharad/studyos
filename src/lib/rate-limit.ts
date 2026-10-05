import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { log } from "@/lib/log";

/**
 * Fixed-window counters kept in Postgres, so every instance (and every serverless invocation)
 * sees the same numbers. One atomic upsert per hit. If the database call fails the limiter
 * fails open: a broken limiter must not take login down with it (the failure is logged).
 */

export interface Rule {
  /** Which counter, e.g. "login:ip". Combined with a subject (IP, user id, email hash). */
  name: string;
  limit: number;
  windowSec: number;
}

export interface Verdict {
  ok: boolean;
  /** Seconds until the window resets (only meaningful when `ok` is false). */
  retryAfterSec: number;
}

export const RULES = {
  /** Every sign-in attempt from one address. Generous: a college network shares one IP. */
  loginIp: { name: "login:ip", limit: 60, windowSec: 600 },
  /** Failed sign-ins for one account, whoever they come from. */
  loginFailures: { name: "login:fail", limit: 8, windowSec: 900 },
  signupIp: { name: "signup:ip", limit: 20, windowSec: 3600 },
  upload: { name: "upload:user", limit: 100, windowSec: 600 },
  /** Each topic-map build can cost an AI call. */
  topicMap: { name: "topicmap:user", limit: 10, windowSec: 3600 },
  deleteAccount: { name: "delete-account:user", limit: 5, windowSec: 3600 },
} satisfies Record<string, Rule>;

const keyFor = (rule: Rule, subject: string) => `${rule.name}:${createHash("sha256").update(subject).digest("hex").slice(0, 32)}`;

const OPEN: Verdict = { ok: true, retryAfterSec: 0 };

/** Counts one hit and says whether the caller is still within the limit. */
export async function hit(rule: Rule, subject: string): Promise<Verdict> {
  try {
    const rows = await db.$queryRaw<{ count: number; retry: number }[]>`
      INSERT INTO rate_limits ("key", "count", "windowStart")
      VALUES (${keyFor(rule, subject)}, 1, now())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN rate_limits."windowStart" <= now() - make_interval(secs => ${rule.windowSec}::float8)
                       THEN 1 ELSE rate_limits."count" + 1 END,
        "windowStart" = CASE WHEN rate_limits."windowStart" <= now() - make_interval(secs => ${rule.windowSec}::float8)
                             THEN now() ELSE rate_limits."windowStart" END
      RETURNING "count",
        EXTRACT(EPOCH FROM (("windowStart" + make_interval(secs => ${rule.windowSec}::float8)) - now()))::float8 AS "retry"`;
    const row = rows[0];
    if (!row) return OPEN;
    void sweep();
    return { ok: row.count <= rule.limit, retryAfterSec: Math.max(1, Math.ceil(row.retry)) };
  } catch (err) {
    log.error("rate limiter unavailable, allowing request", err, { rule: rule.name });
    return OPEN;
  }
}

/** Says whether the caller is already over the limit, without counting this call. */
export async function peek(rule: Rule, subject: string): Promise<Verdict> {
  try {
    const rows = await db.$queryRaw<{ count: number; retry: number }[]>`
      SELECT "count",
        EXTRACT(EPOCH FROM (("windowStart" + make_interval(secs => ${rule.windowSec}::float8)) - now()))::float8 AS "retry"
      FROM rate_limits
      WHERE "key" = ${keyFor(rule, subject)} AND "windowStart" > now() - make_interval(secs => ${rule.windowSec}::float8)`;
    const row = rows[0];
    if (!row) return OPEN;
    return { ok: row.count < rule.limit, retryAfterSec: Math.max(1, Math.ceil(row.retry)) };
  } catch (err) {
    log.error("rate limiter unavailable, allowing request", err, { rule: rule.name });
    return OPEN;
  }
}

/** Forgets old counters now and then (about 1 hit in 200) so the table doesn't grow forever. */
async function sweep() {
  if (Math.random() > 0.005) return;
  try {
    await db.$executeRaw`DELETE FROM rate_limits WHERE "windowStart" < now() - interval '1 day'`;
  } catch (err) {
    log.warn("rate limit sweep failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * The caller's address. Reads the first X-Forwarded-For entry, which is only trustworthy behind a
 * proxy that sets it (Vercel, Cloudflare, nginx and most load balancers do). Without a proxy a client
 * can forge it, which is why account-level limits don't rely on the address alone.
 */
export function clientIp(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

export function waitMessage(verdict: Verdict): string {
  const minutes = Math.ceil(verdict.retryAfterSec / 60);
  return minutes <= 1 ? "Too many attempts. Try again in a minute." : `Too many attempts. Try again in ${minutes} minutes.`;
}

/** Normalised so "A@x.com " and "a@x.com" share one counter. Hashed in `keyFor`, never stored as-is. */
export const emailSubject = (email: string) => email.trim().toLowerCase();
