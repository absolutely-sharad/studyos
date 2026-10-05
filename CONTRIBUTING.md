# Contributing to StudyOS

StudyOS is maintained by Sharad Solutions.

## Project overview

StudyOS turns a student's syllabus, materials and previous-year papers into a deterministic, adaptive study plan. See the README for architecture and the planning engine.

## Development setup

You need Node 20.19+ and PostgreSQL 15+ with the `pgvector` extension. The quickest way to get one:

```bash
docker run -d --name studyos-db -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=studyos pgvector/pgvector:pg16
```

Then:

```bash
cp .env.example .env     # set DATABASE_URL and AUTH_SECRET (npx auth secret)
npm install
npm run db:deploy        # applies the committed migrations
npm run dev
```

## Branch strategy

- `main` is always deployable.
- Work on `feature/<short-name>`, `fix/<short-name>` or `docs/<short-name>` branches.
- Rebase on `main` before opening a pull request.

## Pull request requirements

- One focused change per PR, with a description of what changed and why.
- Screenshots for any UI change (desktop and mobile).
- Database changes include a Prisma migration: edit `prisma/schema.prisma`, run `npm run db:migrate -- --name what_changed`, and commit the new folder in `prisma/migrations`. CI fails if the schema and migrations disagree.
- No secrets, real user data or uploaded files in commits.

## Testing requirements

All of these must pass (CI runs them):

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`npm test` also runs the database tests when `TEST_DATABASE_URL` points at a migrated Postgres, for example `TEST_DATABASE_URL=$DATABASE_URL npm test`. They cover the rate limiter and plan building, including concurrent builds. Without the variable they are skipped.

One worker test (a file that runs out of memory) is skipped when `NODE_OPTIONS` contains `--max-old-space-size`, because that flag overrides a worker's own limit. Run `env -u NODE_OPTIONS npm test` to include it.

Planner, priority or health changes need tests in `tests/planner.test.ts`. Never break a hard constraint: exam date, daily capacity, unavailable days, prerequisites, completed and pinned work.

## Coding standards

- TypeScript strict mode; no `any` without a comment explaining why.
- Every server action and route handler checks the session and resource ownership.
- Planning logic stays deterministic and free of I/O. Database access lives in `service.ts` files.
- Hash and check passwords only through `@/lib/password`, never `bcryptjs` or `crypto` directly: it runs off the main thread and has the busy limit. Parse uploaded files only through the queue (`@/lib/documents/process`), never in a request handler.
- Log with `log` from `@/lib/log`, never `console`. Log ids, not emails, passwords or file contents.
- Files go through `@/lib/storage`, never `fs` directly, so they keep working on serverless hosts.
- Anything that can cost money or be abused (AI calls, uploads, sign-in) goes through `@/lib/rate-limit`.
- UI copy is plain, in sentence case, and never guilt-trips the student.
