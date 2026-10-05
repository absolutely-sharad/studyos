import { Semaphore } from "@/lib/semaphore";
import { singleton } from "@/lib/singleton";

/**
 * Bounds how many uploads are being received at once. Each one holds the whole file in memory several times
 * over while it is read, checked and stored (about 50 MB for a 21 MB PDF), so twenty at once would take over a
 * gigabyte. A few wait in line, but only briefly; beyond that the answer is a quick "busy, retry" and the browser
 * tries again.
 *
 *   UPLOAD_CONCURRENCY=4   uploads received at the same time per server instance
 *
 * One account can hold at most half of the slots, so a single client that stalls (or just uploads a lot at once)
 * can't lock everyone else out.
 */
const limit = () => {
  const configured = Number(process.env.UPLOAD_CONCURRENCY);
  return Number.isInteger(configured) && configured >= 1 ? configured : 4;
};

export const uploadGate = singleton("upload-gate", () => new Semaphore(limit(), limit() * 4));

/** How long an upload may wait for a slot before being told the server is busy. */
export const UPLOAD_WAIT_MS = 10_000;

/** What reading an upload's body may take: no data for this long, or this long in total, and it is dropped. */
export const UPLOAD_BODY_IDLE_MS = 15_000;
export const UPLOAD_BODY_TOTAL_MS = 180_000;

const perUser = singleton("upload-per-user", () => new Map<string, number>());
const perUserLimit = () => Math.max(1, Math.ceil(limit() / 2));

/** Claims one of the account's upload slots. Returns how to give it back, or null if the account is at its limit. */
export function enterUpload(userId: string): (() => void) | null {
  const current = perUser.get(userId) ?? 0;
  if (current >= perUserLimit()) return null;
  perUser.set(userId, current + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (perUser.get(userId) ?? 1) - 1;
    if (left <= 0) perUser.delete(userId);
    else perUser.set(userId, left);
  };
}

export const uploadsInProgress = (userId: string) => perUser.get(userId) ?? 0;
