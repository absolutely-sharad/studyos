import { db } from "@/lib/db";

/** A file stuck in EXTRACTING or CHUNKING for this long was abandoned (the server restarted or crashed) and is picked up again. */
export const STALE_SECONDS = 5 * 60;

/**
 * How many times a file is started before the queue gives up on it. A file that crashes the whole server (a
 * decompression bomb, say) is otherwise found abandoned and started again after every restart, forever.
 */
export const MAX_ATTEMPTS = 3;

export const GAVE_UP_MESSAGE =
  "We couldn't read this file. It may be damaged or too large for us to process. Try re-saving it as a new PDF, or upload a different copy.";

/**
 * Takes up to `limit` files off the queue and marks them as being read. The `documents` table is the queue:
 * a file waits as UPLOADED, and claiming it is one atomic statement, so any number of server instances can
 * call this at once and never get the same file (FOR UPDATE SKIP LOCKED).
 *
 * The line is fair even though files are claimed one at a time: a student's turn is their place in their own
 * line plus the number of their files already being read, so someone with a hundred files waiting still lets
 * everyone else's first file go ahead of their second.
 */
export async function claimDocuments(limit: number): Promise<string[]> {
  // Files that were abandoned too many times are finished off here, not started again.
  await db.$executeRaw`
    UPDATE documents
    SET status = 'FAILED', error = ${GAVE_UP_MESSAGE}, "updatedAt" = now()
    WHERE status IN ('EXTRACTING', 'CHUNKING')
      AND "updatedAt" < now() - make_interval(secs => ${STALE_SECONDS}::float8)
      AND attempts >= ${MAX_ATTEMPTS}::int`;

  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH running AS (
      SELECT "userId", count(*)::int AS files
      FROM documents
      WHERE status IN ('EXTRACTING', 'CHUNKING')
        AND "updatedAt" >= now() - make_interval(secs => ${STALE_SECONDS}::float8)
      GROUP BY "userId"
    ), waiting AS (
      SELECT d.id,
             row_number() OVER (PARTITION BY d."userId" ORDER BY d."createdAt") + COALESCE(r.files, 0) AS turn
      FROM documents d
      LEFT JOIN running r ON r."userId" = d."userId"
      WHERE d.status = 'UPLOADED'
         OR (d.status IN ('EXTRACTING', 'CHUNKING')
             AND d."updatedAt" < now() - make_interval(secs => ${STALE_SECONDS}::float8)
             AND d.attempts < ${MAX_ATTEMPTS}::int)
    ), picked AS (
      SELECT d.id
      FROM documents d
      JOIN waiting w ON w.id = d.id
      -- Checked again on the locked row: another instance may have claimed it since the CTEs above were read.
      WHERE d.status = 'UPLOADED'
         OR (d.status IN ('EXTRACTING', 'CHUNKING')
             AND d."updatedAt" < now() - make_interval(secs => ${STALE_SECONDS}::float8)
             AND d.attempts < ${MAX_ATTEMPTS}::int)
      ORDER BY w.turn, d."createdAt"
      LIMIT ${limit}::int
      FOR UPDATE OF d SKIP LOCKED
    )
    UPDATE documents
    SET status = 'EXTRACTING', error = NULL, attempts = attempts + 1, "updatedAt" = now()
    WHERE id IN (SELECT id FROM picked)
    RETURNING id`;
  return rows.map((r) => r.id);
}
