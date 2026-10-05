// StudyOS database check: run `npm run db:check` (or `node scripts/db-check.mjs`).
// Prints what is wrong with DATABASE_URL in plain English. Never prints your password.
import { existsSync, readFileSync } from "node:fs";
import dotenv from "dotenv";
import pg from "pg";

const fromShell = Boolean(process.env.DATABASE_URL);
dotenv.config({ quiet: true });
const raw = process.env.DATABASE_URL ?? "";
const done = (ok, msg) => {
  console.log(`\n${ok ? "OK" : "PROBLEM"}: ${msg}\n`);
  process.exit(ok ? 0 : 1);
};

if (fromShell) console.log("Note: DATABASE_URL is set in your terminal, which overrides .env. Run `unset DATABASE_URL` if that's not intended.");
for (const f of [".env.local", ".env.development", ".env.development.local"])
  if (existsSync(f) && /^\s*DATABASE_URL\s*=/m.test(readFileSync(f, "utf8")))
    console.log(`Note: ${f} also sets DATABASE_URL and overrides .env for the app.`);

if (!raw) done(false, "DATABASE_URL is empty. Add it to .env (Supabase: Connect > URI > Session pooler).");
let url;
try {
  url = new URL(raw);
} catch {
  done(false, `DATABASE_URL isn't a valid link. It starts with ${JSON.stringify(raw.slice(0, 14))}. It must start with "postgresql://", use straight quotes, and be on one line.`);
}
if (!/^postgres(ql)?:$/.test(url.protocol)) done(false, `The link starts with "${url.protocol}//" but must start with "postgresql://". Copy the URI type, not JDBC.`);
if (/[[\]]/.test(decodeURIComponent(url.password))) done(false, "The password still contains [ or ]. Remove the brackets around it.");
console.log(`Checking ${decodeURIComponent(url.username)}@${url.host}${url.pathname} ...`);
if (url.host.includes("pooler.supabase.com") && !url.username.includes("."))
  done(false, "Supabase pooler links need the username postgres.<project-id>, not just postgres. Re-copy the Session pooler link.");

const client = new pg.Client({ connectionString: raw, connectionTimeoutMillis: 10_000 });
try {
  await client.connect();
} catch (e) {
  const code = e.code ?? "";
  const msg = String(e.message ?? e);
  if (code === "28P01" || /password authentication failed/i.test(msg))
    done(false, "Supabase rejected the password. Reset it (Project Settings > Database), use only letters and numbers, and paste it into .env.");
  if (/tenant or user not found/i.test(msg))
    done(false, "Supabase doesn't recognise this username and host together. Re-copy the Session pooler link exactly (check aws-0 vs aws-1 and the region).");
  if (code === "ENOTFOUND") done(false, `The host ${url.hostname} doesn't exist. Re-copy the link from Supabase.`);
  if (["ETIMEDOUT", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"].includes(code) || /timeout/i.test(msg))
    done(false, "Can't reach Supabase from this network. College and office Wi-Fi often block port 5432, so try your phone's hotspot. Also check the project isn't paused.");
  done(false, `Couldn't connect: ${code} ${msg}`);
}

const { rows } = await client.query(
  "select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name in ('users', 'accounts', 'exams', 'study_tasks')",
);
await client.end();
if (rows[0].n < 4) done(false, "Connected, but StudyOS's tables don't exist yet. Run: npm run db:migrate -- --name init");
done(true, "Database connected and tables exist. Restart the app (Ctrl + C, then npm run dev) and sign in at http://localhost:3000");
