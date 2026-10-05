# Deploying StudyOS

This is the runbook for running StudyOS in production. It covers what you need, how to ship it on Docker or Vercel, and how to run it afterwards.

## Before you go live

- [ ] **Database**: PostgreSQL 15+ with the `pgvector` extension (Supabase and Neon both have it). Use a managed instance with automated backups.
- [ ] **Migrations applied**: `npm run db:deploy` (see [Database](#database-and-migrations)).
- [ ] **`AUTH_SECRET`**: at least 32 random characters (`npx auth secret`). Keep it stable: changing it signs everyone out.
- [ ] **`AUTH_URL`**: your public address, for example `https://studyos.example.com`.
- [ ] **Storage**: a persistent location for uploads (see [Storage](#storage)). Local disk is wrong on serverless hosts.
- [ ] **HTTPS** in front of the app. Cookies and the HSTS header assume it.
- [ ] **Uptime monitor** on `GET /api/health`.
- [ ] **Backups** for the database *and* the file storage (see [Backups](#backups-and-data-deletion)).
- [ ] Decide on the things StudyOS does not provide yet (see [Known gaps](#known-gaps)).

The server checks its configuration when it starts. In production it refuses to boot, with a message naming each problem, if `DATABASE_URL` or `AUTH_SECRET` is missing or weak, if the storage settings are inconsistent, or if local storage is selected on a serverless host.

## Database and migrations

The schema ships as Prisma migrations in `prisma/migrations`. Apply them with:

```bash
DATABASE_URL=postgresql://... npm run db:deploy
```

It is safe to run on every release: it applies what is pending and does nothing otherwise. Run it as a release step, not as part of `next build`, so a database outage can't fail your build.

**Changing the schema.** Edit `prisma/schema.prisma`, then `npm run db:migrate -- --name what_changed` against a development database and commit the new folder under `prisma/migrations`. CI fails if the schema and the migrations disagree.

**A database you created earlier with `prisma db push`** already has the first migration's tables. Tell Prisma so it doesn't try to create them again, then deploy the rest:

```bash
npx prisma migrate resolve --applied 20261005000000_init
npm run db:deploy
```

**Connection pooling.** On serverless hosts every instance opens its own connections. Use your provider's pooled connection string (Supabase "Transaction pooler" or "Session pooler", Neon's pooled host) and set `DATABASE_POOL_MAX=1` or `2`. On a single long-running server the default of 10 is fine.

## Storage

Uploaded files (syllabus PDFs, notes, papers) are stored outside the database, selected by `STORAGE_DRIVER`.

### `local` (default)

Files go to `UPLOAD_DIR` on the machine's disk. Use this for development, or for one server with a **persistent volume**. Back the folder up.

### `supabase`

Required on Vercel and other serverless hosts, where the file system is wiped between requests.

1. In Supabase, open **Storage → New bucket**. Name it `studyos-documents` (or set `SUPABASE_STORAGE_BUCKET`). Leave **Public bucket off**.
2. Set `STORAGE_DRIVER=supabase`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API).
3. Upload a small file in the app and confirm it opens from the file list.

The service-role key bypasses row-level security. It must only ever be set as a server-side secret. The bucket stays private, and files leave it only through `/api/documents/[id]/file`, which checks that the signed-in user owns the document.

Other stores (S3, R2) are a small addition: implement the `Driver` interface in `src/lib/storage.ts`.

## Running on Docker

```bash
# 1. Build. NEXT_PUBLIC_* values are baked into the browser bundle, so pass them here.
docker build -t studyos --build-arg NEXT_PUBLIC_APP_URL=https://studyos.example.com .
docker build -t studyos-migrate --target migrate .

# 2. Apply migrations (a one-off job; run it on every release)
docker run --rm -e DATABASE_URL="$DATABASE_URL" studyos-migrate

# 3. Run the app
docker run -d --name studyos -p 3000:3000 \
  -e DATABASE_URL -e AUTH_SECRET -e AUTH_URL -e AUTH_TRUST_HOST=true \
  -e ANTHROPIC_API_KEY \
  -v studyos-data:/data \
  studyos
```

- The image runs as an unprivileged user (uid 1001) and listens on port 3000.
- `/data/uploads` is the upload folder for `STORAGE_DRIVER=local`. Mount a named volume as above. A host folder must be writable by uid 1001. With `STORAGE_DRIVER=supabase` no volume is needed.
- `AUTH_TRUST_HOST=true` is needed behind any reverse proxy or load balancer, so Auth.js accepts the forwarded host.
- The image has a built-in health check against `/api/health`.
- To pin or mirror the base image: `--build-arg NODE_IMAGE=node:22-slim@sha256:...`.

## Running on Vercel

1. Import the repository. The default build command (`npm run build`) works as is.
2. Set the environment variables below. Use `STORAGE_DRIVER=supabase`, a pooled `DATABASE_URL`, and `DATABASE_POOL_MAX=1`.
3. Run `npm run db:deploy` against the production database before the first deploy and on each release that adds a migration (a GitHub Action or your own terminal both work).
4. Request time limits: the upload route allows 60 seconds. Building a topic map with AI can take over a minute on a long syllabus, so confirm your plan's function duration covers it. If the call times out the app falls back to its built-in parser and tells the student.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `DATABASE_POOL_MAX` | No | Connections per server instance. Default 10. |
| `AUTH_SECRET` | Yes | Session signing secret, 32+ characters in production |
| `AUTH_URL` | Recommended | Public address of the app |
| `AUTH_TRUST_HOST` | Behind a proxy | `true` when you run your own reverse proxy (not needed on Vercel) |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | No | Both set: shows "Continue with Google" |
| `ANTHROPIC_API_KEY` | No | AI syllabus extraction. Without it the rule-based parser is used. |
| `ANTHROPIC_MODEL` | No | Defaults to `claude-sonnet-5-5` |
| `STORAGE_DRIVER` | No | `local` (default) or `supabase` |
| `UPLOAD_DIR` | No | Folder for `local` storage. Default `.uploads` (`/data/uploads` in the image). |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | With `supabase` | Storage credentials. Bucket defaults to `studyos-documents`. |
| `PROCESSING_CONCURRENCY` | No | Files read at once per instance. Default 3. |
| `LOG_LEVEL` | No | `debug`, `info`, `warn` or `error`. Default `info`. |
| `NEXT_PUBLIC_APP_URL` | Recommended | Canonical links and social previews. **Set at build time.** |
| `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_COMPANY_NAME`, `NEXT_PUBLIC_DEVELOPER_NAME`, `NEXT_PUBLIC_GITHUB_URL`, `NEXT_PUBLIC_LINKEDIN_URL` | No | Branding. **Set at build time.** |
| `SECURITY_CONTACT_EMAIL` | No | Shown in the security policy process |

`NEXT_PUBLIC_*` values are compiled into the JavaScript at build time. Changing one means rebuilding.

## Operating it

### Health

`GET /api/health` returns `200 {"status":"ok","database":"up",...}` when the app can reach its database, and `503` otherwise. It is never cached and exposes nothing sensitive. Point your uptime monitor and load balancer at it.

### Logs

Production logs are one JSON object per line on stdout and stderr (`level`, `time`, `msg`, plus fields), which Vercel, `docker logs`, Datadog and CloudWatch all parse. Every unhandled server error is logged with `request failed`, the route and a `digest`. The same digest is shown to the student as "Reference", so you can find the exact error when someone reports one. Set `LOG_LEVEL=debug` to see more.

Worth alerting on: `request failed`, `database pool error`, `rate limiter unavailable`, `document processing failed`, and any `/api/health` 503.

### Rate limits

Counters live in the database (`rate_limits` table), so they hold across instances and serverless invocations. Old counters are cleaned up automatically.

| Action | Limit |
| --- | --- |
| Sign-in attempts from one address | 60 per 10 minutes |
| Failed sign-ins for one account | 8 per 15 minutes (then the account is locked for the rest of the window, even for the right password) |
| Sign-ups from one address | 20 per hour |
| Uploads per user | 100 per 10 minutes |
| AI topic-map builds per user (only when `ANTHROPIC_API_KEY` is set) | 10 per hour |
| Account deletion attempts per user | 5 per hour |

The per-address limits read the first `X-Forwarded-For` entry, which is trustworthy behind Vercel, Cloudflare, nginx and most load balancers. If clients can reach the app directly, they can forge that header, which is why the per-account limit doesn't rely on it. If the limiter's database call fails, requests are allowed and the failure is logged, so a limiter problem can't take sign-in down.

### Document processing

Files are read after the upload response is sent (`after()`), at most `PROCESSING_CONCURRENCY` at a time per instance. A file stuck mid-pipeline for over 5 minutes (for example because the server restarted) is picked up again the next time the student's file list is loaded. PDFs over 1,500 pages are rejected with a message asking for smaller files.

For large volumes, move this to a queue (Inngest, BullMQ, Trigger.dev). Nothing else needs to change: `processDocument(id)` is the single entry point.

### Scaling

The app is stateless apart from the database and file storage, so you can run several instances. Plan builds take a per-exam database lock, so two simultaneous builds (a double-click, two tabs) can't create duplicate plans.

## Backups and data deletion

- **Database**: use your provider's automated backups and test a restore. Everything a student created lives here.
- **Files**: back up the storage folder or bucket. Restoring the database without the files leaves documents that show "the file is no longer in storage".
- **Account deletion**: Settings → Delete my account permanently removes the student's profile, exams, topics, plans, progress and uploaded files. It cannot be undone, and backups keep their copy until they expire, so state your retention period in your privacy policy.

## Security summary

- Every query and file read is scoped to the signed-in user.
- Passwords are hashed with bcrypt (cost 12); sign-in takes the same time whether or not the email exists.
- Uploads are checked by extension *and* file contents, stored under generated names, and served with a content type derived from the verified file kind, never the browser's claim. PDFs and text open inline; DOCX downloads. The viewer route adds `nosniff`, `no-store`, and a sandboxing Content-Security-Policy for non-PDF files.
- Every page sends a Content-Security-Policy that limits scripts, frames, forms and connections to the app itself (plus Google Fonts), `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` and HSTS.
- Dependencies are audited in CI (`npm audit --audit-level=high`) and updated weekly by Dependabot.

## Known gaps

StudyOS does not yet have these. None blocks a launch, but decide each one on purpose:

- **Password reset and email verification.** There is no email integration, so a student who forgets their password cannot recover the account, and sign-ups are not verified. Google sign-in avoids both. Adding transactional email (for example Resend or any SMTP provider) is the next step.
- **Privacy policy and terms of service.** Students upload their own material and the app can send syllabus text to Anthropic when AI is enabled. You need a policy that says so, written for where your users live.
- **A document-processing queue** (see above) and **OCR for scanned PDFs**, which are flagged to the student rather than read.
- **Error tracking.** Errors are logged but not sent to a service such as Sentry. `onRequestError` in `src/instrumentation.ts` is the place to add it.
