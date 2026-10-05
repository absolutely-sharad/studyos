import dotenv from "dotenv";
import pg from "pg";
dotenv.config({ quiet: true });
const raw = process.env.DATABASE_URL ?? "";
const out = (ok, m) => { console.log(`\n${ok ? "OK" : "PROBLEM"}: ${m}\n`); process.exit(ok ? 0 : 1); };
if (!raw) out(false, "DATABASE_URL is empty in .env.");
let u;
try { u = new URL(raw); } catch { out(false, `DATABASE_URL isn't a valid link. It starts with ${JSON.stringify(raw.slice(0, 14))}.`); }
console.log(`Checking ${decodeURIComponent(u.username)}@${u.host} ...`);
const c = new pg.Client({ connectionString: raw, connectionTimeoutMillis: 10000 });
try { await c.connect(); } catch (e) {
  const m = `${e.code ?? ""} ${e.message}`;
  if (/28P01|password authentication failed/i.test(m)) out(false, "Supabase rejected the password. Reset it and update .env.");
  if (/tenant or user not found/i.test(m)) out(false, "Username and host don't match. Re-copy the Session pooler link.");
  if (/ENOTFOUND/.test(m)) out(false, "Host not found. Re-copy the link from Supabase.");
  if (/ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|timeout/i.test(m)) out(false, "Can't reach Supabase from this network. Try your phone's hotspot.");
  out(false, m);
}
const { rows } = await c.query("select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name in ('users', 'accounts', 'exams', 'study_tasks')");
await c.end();
if (rows[0].n < 4) out(false, "Connected, but the tables are missing. Run: npm run db:migrate -- --name init");
out(true, "Connected and tables exist. Restart the app (Ctrl + C, then npm run dev) and sign in.");
