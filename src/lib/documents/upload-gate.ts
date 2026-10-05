import { Semaphore } from "@/lib/semaphore";
import { singleton } from "@/lib/singleton";

/**
 * Bounds how many uploads are being received at once. Each one holds the whole file in memory several times
 * over while it is read, checked and stored (about 50 MB for a 21 MB PDF), so twenty at once would take over a
 * gigabyte. A few wait in line; beyond that the answer is a quick "busy, retry" and the browser tries again.
 *
 *   UPLOAD_CONCURRENCY=4   uploads received at the same time per server instance
 */
const limit = () => {
  const configured = Number(process.env.UPLOAD_CONCURRENCY);
  return Number.isInteger(configured) && configured >= 1 ? configured : 4;
};

export const uploadGate = singleton("upload-gate", () => new Semaphore(limit(), limit() * 4));
