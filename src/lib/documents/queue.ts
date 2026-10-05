import { db } from "@/lib/db";

/** A file stuck in EXTRACTING or CHUNKING for this long was abandoned (the server restarted or crashed) and is picked up again. */
export const STALE_SECONDS = 5 * 60;

/**
 * Takes up to `limit` files off the queue and marks them as being read. The `documents` table is the queue:
 * a file waits as UPLOADED, and claiming it is one atomic statement, so any number of server instances can
 * call this at once and never get the same file (FOR UPDATE SKIP LOCKED).
 *
 * The line is fair: everyone's first waiting file goes before anyone's second, so one student uploading a
 * hundred files can't keep the rest waiting behind them.
 */
export async function claimDocuments(limit: number): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH waiting AS (
      SELECT id, row_number() OVER (PARTITION BY "userId" ORDER BY "createdAt") AS turn
      FROM documents
      WHERE status = 'UPLOADED'
         OR (status IN ('EXTRACTING', 'CHUNKING') AND "updatedAt" < now() - make_interval(secs => ${STALE_SECONDS}::float8))
    ), picked AS (
      SELECT d.id
      FROM documents d
      JOIN waiting w ON w.id = d.id
      -- Checked again on the locked row: another instance may have claimed it since the CTE above was read.
      WHERE d.status = 'UPLOADED'
         OR (d.status IN ('EXTRACTING', 'CHUNKING') AND d."updatedAt" < now() - make_interval(secs => ${STALE_SECONDS}::float8))
      ORDER BY w.turn, d."createdAt"
      LIMIT ${limit}::int
      FOR UPDATE OF d SKIP LOCKED
    )
    UPDATE documents
    SET status = 'EXTRACTING', error = NULL, "updatedAt" = now()
    WHERE id IN (SELECT id FROM picked)
    RETURNING id`;
  return rows.map((r) => r.id);
}
