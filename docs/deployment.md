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
4. Document reading starts from `after()` on each upload and each file-list request (the 30-second sweeper is not run on Vercel). Worker threads are used there too; this has not been verified on Vercel. If they can't start, one error is logged and files are read in the function instead, or set `PROCESSING_MODE=inline` to choose that.
5. Request time limits: the upload route allows 60 seconds. Building a topic map with AI can take over a minute on a long syllabus, so confirm your plan's function duration covers it. If the call times out the app falls back to its built-in parser and tells the student.

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
| `PROCESSING_CONCURRENCY` | No | Files read at the same time per instance. Default 3. |
| `PROCESSING_MODE` | No | `threads` (default) reads files on worker threads; `inline` reads them in the web process (for hosts without worker threads) |
| `PROCESSING_TIMEOUT_SECONDS` | No | Give up on one file after this long. Default 180. |
| `PROCESSING_WORKER_MEMORY_MB` | No | Memory ceiling for each worker thread. Default 768. See [Memory](#memory). |
| `UPLOAD_CONCURRENCY` | No | Uploads received at the same time per instance. Default 4, with 16 more allowed to wait. |
| `PASSWORD_HASH_CONCURRENCY` | No | Password checks run at once per instance. Default: your CPU count minus one, at most 3. |
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

Uploaded files are read in the background, and the web server's main thread never does the heavy work.

1. **Upload**: the file is checked, stored, and a row is added to `documents` with status `UPLOADED` (shown to the student as "Queued"). A few uploads are received at a time (`UPLOAD_CONCURRENCY`) and one account may hold at most half of those slots. A request waits up to 10 seconds for a slot, then gets a quick `503` with `Retry-After`, and the browser retries by itself. A client that stops sending for 15 seconds, or takes over 3 minutes, is dropped with a `408` and its slot is freed.
2. **Queue**: the `documents` table is the queue. An instance claims a file with one atomic statement (`FOR UPDATE SKIP LOCKED`), so any number of instances can run at once and never read the same file twice. The line is fair even though files are claimed one at a time: a student's turn counts their own waiting files *and* the files of theirs already being read, so one student uploading a hundred files can't keep the rest waiting. A new upload wakes a pass that is busy with a long file, so a small file isn't held up behind it.
3. **Read**: parsing the PDF/DOCX, detecting what kind of material it is, and cutting it into chunks happen on a **worker thread** (at most `PROCESSING_CONCURRENCY` at a time). The web process only moves bytes and talks to the database.
4. **Finish**: chunks are saved and the file becomes `READY`. Files that can't be read end as `FAILED` (with a plain-language reason) or `NEEDS_OCR` (scanned PDFs).

Things that go wrong, and what happens:

| Situation | Result |
| --- | --- |
| A file takes longer than `PROCESSING_TIMEOUT_SECONDS` | Its worker is discarded; the student sees "Reading this file took too long" |
| A file needs more memory than a worker may use, including a small file that decompresses to gigabytes | The memory watchdog (below) terminates that worker within about 100 ms of it passing the ceiling; the student sees "too large or complex"; the web process is untouched |
| A worker crashes | The file fails with a generic message and is logged; a fresh worker handles the next file |
| The server restarts mid-read | The file is picked up again after 5 minutes (by the 30-second sweeper on a normal server, or the next request on serverless) |
| A file keeps killing the whole server | Each pick-up is counted. After 3 starts the file is marked `FAILED` ("We couldn't read this file…") instead of being tried again, so it can crash the server at most 3 times |
| A client stalls or trickles an upload | Dropped after 15 s without data or 3 minutes in total (`408`), freeing its slot |
| Workers can't start on this host | One loud `document workers cannot start here` error is logged and files are read in the web process from then on. Set `PROCESSING_MODE=inline` to choose that on purpose. |
| PDFs over 1,500 pages | Refused with a message asking for smaller files |

Starting processing: every upload and every file-list request calls it (so serverless hosts work), and a normal server also runs a sweeper every 30 seconds. Workers start on demand and exit after 60 idle seconds.

#### Memory

Each worker has a memory ceiling (`PROCESSING_WORKER_MEMORY_MB`, default 768) covering its heap **and** the buffers it allocates, so the worst case is about `PROCESSING_CONCURRENCY × 768 MB` on top of the web process. It is enforced two ways:

- V8's own heap limit for the worker, and
- a **memory watchdog**: while a file is being read, the pool checks the worker's heap plus buffers every 100 ms (`worker.getHeapStatistics()`, which answers even while the worker is busy) and terminates it above the ceiling. This matters because V8's heap limit does not count the buffers a decompressor allocates, and a 1 MB file can inflate to gigabytes. Measured: a 1.5 MB PDF that inflates to 1.5 GB was stopped at 807 MB, 36 ms after it crossed 800 MB.

The watchdog needs **Node 22.16 or later**. On an older Node the server logs a warning at the first upload and only the heap limit applies, which a crafted file can get around. The Docker image uses Node 22. `PROCESSING_MODE=inline` (or the automatic fallback when workers can't start) reads files inside the web process and has **no** memory protection.

Measured: about 190 MB idle, about 900 MB at peak with 20 large uploads in flight, and a worker that hits the ceiling takes the process to roughly the web baseline plus the whole ceiling (959 MB with the default). Memory a worker used is not always handed back to the operating system when it ends (875 MB idle after two decompression bombs, against 190 MB before), so plan for the peak, not the idle figure.

Size the container so that **about 400 MB (the web process and upload buffers) + `PROCESSING_CONCURRENCY` × `PROCESSING_WORKER_MEMORY_MB`** fits. Ready-made combinations (computed from that rule, not each separately tested):

| Container memory | `PROCESSING_CONCURRENCY` | `PROCESSING_WORKER_MEMORY_MB` | `UPLOAD_CONCURRENCY` |
| --- | --- | --- | --- |
| 1 GB | 2 | 256 | 3 |
| 2 GB | 2 | 640 | 4 |
| 4 GB or more | 3 (default) | 768 (default) | 4 (default) |

Below 1 GB is not recommended: the web process alone needs 200 to 300 MB, and a worker ceiling under about 200 MB will refuse large PDFs.

Avoid `--max-old-space-size` in `NODE_OPTIONS` (some guides recommend it). It is process-wide and overrides V8's heap limit for every worker. The watchdog still enforces `PROCESSING_WORKER_MEMORY_MB`, but only between its 100 ms checks, so a file can overshoot. If the flag is set, the server logs a warning at the first upload.

### Passwords

Passwords are hashed with scrypt (N=2^15, r=8, p=3, about 0.25 s and 32 MB each), which Node runs on its thread pool, so a burst of sign-ins uses other cores instead of freezing the site. At most `PASSWORD_HASH_CONCURRENCY` checks run at once per instance and 50 more may wait; beyond that sign-in and sign-up answer "We're busy right now, try again in a few seconds" immediately. That answer is never counted as a failed attempt.

Accounts created before this change have bcrypt hashes. They still work and are upgraded to scrypt the first time their owner signs in. That one check runs on the main thread (about 0.4 s), and during it a legacy account's sign-in takes a little longer than an unknown email's, so the timing equalisation is complete once everyone has signed in once.

### Capacity

Measured on one 4-core machine (client, app and database sharing it), one app instance, 1,000 seeded students with about 500 planned tasks each:

| | Result |
| --- | --- |
| 100 students browsing at once | comfortable: p95 about 290 ms |
| 300 students browsing at once | one instance saturates at about 30–35 requests/s; a second instance raised it to 51 requests/s (1.75×) on this machine, which was by then short of cores |
| Sign-ins | 12.7/s per instance with other users unaffected (`/api/health` stayed at 6 ms); before the change 4/s, with everyone else stalled for seconds |
| 12 students uploading 250-page textbooks | everyone else's dashboard stayed at 78 ms (it was 2.7 s when parsing ran on the web thread) |

Plan for roughly 100 to 150 actively browsing students per instance and add instances for more. Each instance opens up to `DATABASE_POOL_MAX` connections (default 10), so several instances need a connection pooler or a lower value.

### Scaling

The app is stateless apart from the database and file storage, so you can run several instances. Plan builds take a per-exam database lock, so two simultaneous builds (a double-click, two tabs) can't create duplicate plans. The upload, sign-in and file-reading limits above are per instance; the rate limits (above) and the file queue are shared through the database.

## Backups and data deletion

- **Database**: use your provider's automated backups and test a restore. Everything a student created lives here.
- **Files**: back up the storage folder or bucket. Restoring the database without the files leaves documents that show "the file is no longer in storage".
- **Account deletion**: Settings → Delete my account permanently removes the student's profile, exams, topics, plans, progress and uploaded files. It cannot be undone, and backups keep their copy until they expire, so state your retention period in your privacy policy.

## Security summary

- Every query and file read is scoped to the signed-in user.
- Passwords are hashed with scrypt on a thread pool (older bcrypt hashes are upgraded at next sign-in); sign-in takes the same time whether or not the email exists.
- Uploads are checked by extension *and* file contents, stored under generated names, and served with a content type derived from the verified file kind, never the browser's claim. PDFs and text open inline; DOCX downloads. The viewer route adds `nosniff`, `no-store`, and a sandboxing Content-Security-Policy for non-PDF files.
- Every page sends a Content-Security-Policy that limits scripts, frames, forms and connections to the app itself (plus Google Fonts), `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` and HSTS.
- Dependencies are audited in CI (`npm audit --audit-level=high`) and updated weekly by Dependabot.

## Known gaps

StudyOS does not yet have these. None blocks a launch, but decide each one on purpose:

- **Password reset and email verification.** There is no email integration, so a student who forgets their password cannot recover the account, and sign-ups are not verified. Google sign-in avoids both. Adding transactional email (for example Resend or any SMTP provider) is the next step.
- **Privacy policy and terms of service.** Students upload their own material and the app can send syllabus text to Anthropic when AI is enabled. You need a policy that says so, written for where your users live.
- **OCR for scanned PDFs**, which are flagged to the student rather than read. (A separate worker service and a dedicated job queue such as Inngest or BullMQ are optional upgrades: file reading already runs on worker threads fed from the database queue, and `processPending()` in `src/lib/documents/process.ts` is the single entry point to move.)
- **Error tracking.** Errors are logged but not sent to a service such as Sentry. `onRequestError` in `src/instrumentation.ts` is the place to add it.
