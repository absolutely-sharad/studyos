import { z } from "zod";

/**
 * Environment checks, run once when the server starts (see src/instrumentation.ts).
 * Production refuses to boot on a broken configuration instead of failing on the first request.
 * `checkEnv` is pure so it can be tested; it never reads process.env itself.
 */

type Env = Record<string, string | undefined>;

export interface EnvReport {
  errors: string[];
  warnings: string[];
}

const nonEmpty = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

const postgresUrl = z
  .string()
  .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must start with "postgresql://"');

export function checkEnv(env: Env): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const production = env.NODE_ENV === "production";
  const get = (k: string) => nonEmpty(env[k]);

  const database = postgresUrl.safeParse(get("DATABASE_URL") ?? "");
  if (!get("DATABASE_URL")) errors.push("DATABASE_URL is not set.");
  else if (!database.success) errors.push(`DATABASE_URL ${database.error.issues[0]?.message}.`);

  const secret = get("AUTH_SECRET");
  if (!secret) errors.push("AUTH_SECRET is not set. Generate one with: npx auth secret");
  else if (production && secret.length < 32) errors.push("AUTH_SECRET is too short. Use at least 32 random characters (npx auth secret).");

  const googleId = get("AUTH_GOOGLE_ID");
  const googleSecret = get("AUTH_GOOGLE_SECRET");
  if (Boolean(googleId) !== Boolean(googleSecret))
    warnings.push("Only one of AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET is set, so Google sign-in is disabled.");

  const driver = get("STORAGE_DRIVER") ?? "local";
  if (driver !== "local" && driver !== "supabase") errors.push(`STORAGE_DRIVER must be "local" or "supabase", not "${driver}".`);
  if (driver === "supabase") {
    if (!get("SUPABASE_URL")) errors.push("STORAGE_DRIVER=supabase needs SUPABASE_URL.");
    if (!get("SUPABASE_SERVICE_ROLE_KEY")) errors.push("STORAGE_DRIVER=supabase needs SUPABASE_SERVICE_ROLE_KEY.");
  }
  if (driver === "local" && production) {
    // Serverless file systems are wiped between invocations, so uploads would silently vanish.
    if (env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.NETLIFY)
      errors.push('STORAGE_DRIVER=local loses uploads on serverless hosts. Set STORAGE_DRIVER=supabase.');
    else warnings.push("STORAGE_DRIVER=local keeps uploads on this machine's disk. Mount a persistent volume at UPLOAD_DIR and back it up.");
  }

  const concurrency = get("PROCESSING_CONCURRENCY");
  if (concurrency && !(Number.isInteger(Number(concurrency)) && Number(concurrency) >= 1))
    warnings.push("PROCESSING_CONCURRENCY should be a whole number of 1 or more; the default of 3 is used.");

  if (production && !get("ANTHROPIC_API_KEY")) warnings.push("ANTHROPIC_API_KEY is not set, so the built-in rule-based syllabus parser is used.");

  return { errors, warnings };
}
