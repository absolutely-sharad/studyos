# Contributing to StudyOS

StudyOS is maintained by Sharad Solutions.

## Project overview

StudyOS turns a student's syllabus, materials and previous-year papers into a deterministic, adaptive study plan. See the README for architecture and the planning engine.

## Development setup

```bash
cp .env.example .env
npm install
npm run db:migrate -- --name init
npm run dev
```

## Branch strategy

- `main` is always deployable.
- Work on `feature/<short-name>`, `fix/<short-name>` or `docs/<short-name>` branches.
- Rebase on `main` before opening a pull request.

## Pull request requirements

- One focused change per PR, with a description of what changed and why.
- Screenshots for any UI change (desktop and mobile).
- Database changes include a Prisma migration.
- No secrets, real user data or uploaded files in commits.

## Testing requirements

All of these must pass:

```bash
npm test
npm run typecheck
npm run build
```

Planner, priority or health changes need tests in `tests/planner.test.ts`. Never break a hard constraint: exam date, daily capacity, unavailable days, prerequisites, completed and pinned work.

## Coding standards

- TypeScript strict mode; no `any` without a comment explaining why.
- Every server action and route handler checks the session and resource ownership.
- Planning logic stays deterministic and free of I/O. Database access lives in `service.ts` files.
- UI copy is plain, in sentence case, and never guilt-trips the student.
