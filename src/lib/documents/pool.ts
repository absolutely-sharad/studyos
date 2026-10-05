import { Worker } from "node:worker_threads";
import { log } from "@/lib/log";
import { Semaphore } from "@/lib/semaphore";
import { singleton } from "@/lib/singleton";
import { analyzeDocument, type Analysis } from "./analyze";
import { DocumentError, type DocumentKind } from "./extract";
import type { WorkerReady, WorkerRequest, WorkerResponse } from "./worker-protocol";

/**
 * Reads uploaded files on worker threads, so parsing a 600-page PDF can't freeze the web server for everyone
 * else. Each worker has its own memory ceiling: a malicious or enormous file takes down its own worker (the
 * student gets a clear message) instead of the whole process. Workers start on demand and go away when idle.
 *
 *   PROCESSING_MODE=threads (default) | inline     inline analyses on the main thread (tests, or hosts without worker threads)
 *   PROCESSING_CONCURRENCY=3                       files read at the same time per server instance
 *   PROCESSING_TIMEOUT_SECONDS=180                 give up on one file after this long
 *   PROCESSING_WORKER_MEMORY_MB=768                memory ceiling for each worker (heap plus buffers)
 *
 * The ceiling has two parts. V8's own heap limit (`resourceLimits`) stops runaway objects, but it does not count the
 * buffers a decompressor allocates, and a 1 MB file can inflate to gigabytes. So while a file is being read, the pool
 * also checks the worker's heap plus buffers every 100 ms from outside and terminates it above the ceiling.
 */

const envInt = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 1 ? value : fallback;
};
export const processingConcurrency = () => envInt("PROCESSING_CONCURRENCY", 3);
const timeoutMs = () => envInt("PROCESSING_TIMEOUT_SECONDS", 180) * 1000;
const memoryMb = () => envInt("PROCESSING_WORKER_MEMORY_MB", 768);
const READY_TIMEOUT_MS = 20_000;
const WATCHDOG_MS = 100;
const IDLE_MS = 60_000;

const TIMEOUT_MESSAGE = "Reading this file took too long. Try splitting it into smaller files and uploading those.";
const OUT_OF_MEMORY_MESSAGE = "This file is too large or complex to read. Try splitting it into smaller files and uploading those.";

/** The worker never got going (missing file, unsupported host). Nothing was lost: the file can be read another way. */
export class WorkerStartError extends Error {
  constructor(cause: unknown) {
    super("The document worker could not start", { cause });
    this.name = "WorkerStartError";
  }
}

interface Slot {
  worker: Worker;
  /** Settles once the worker has loaded and said hello. */
  ready: Promise<void>;
  idleTimer?: ReturnType<typeof setTimeout>;
  retired: boolean;
}

interface Pool {
  idle: Slot[];
  total: number;
  nextId: number;
  gate: Semaphore;
  factory: () => Worker;
  /** Set when workers can't start here. From then on files are read in-process, and that was logged as an error. */
  degraded: boolean;
  limitWarned: boolean;
  watchdogWarned: boolean;
}

function defaultFactory(): Worker {
  // The literal `new Worker(new URL(...))` form is what lets Next.js bundle the worker file with the app.
  return new Worker(new URL("./extract-worker.ts", import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: memoryMb() } });
}

const pool = singleton<Pool>("document-pool", () => ({
  idle: [],
  total: 0,
  nextId: 1,
  gate: new Semaphore(processingConcurrency()),
  factory: defaultFactory,
  degraded: false,
  limitWarned: false,
  watchdogWarned: false,
}));

function retire(slot: Slot) {
  if (slot.retired) return;
  slot.retired = true;
  pool.total--;
  clearTimeout(slot.idleTimer);
  const at = pool.idle.indexOf(slot);
  if (at >= 0) pool.idle.splice(at, 1);
  slot.worker.terminate().catch(() => undefined);
}

function release(slot: Slot) {
  slot.idleTimer = setTimeout(() => retire(slot), IDLE_MS);
  slot.idleTimer.unref();
  pool.idle.push(slot);
}

/**
 * A process-wide `--max-old-space-size` (for instance from NODE_OPTIONS) overrides each worker's own heap limit. The
 * memory watchdog still stops a worker that passes the ceiling, but only when it next looks (every 100 ms) rather
 * than the moment V8 hits it, so a file can overshoot. Say so once instead of letting the setting look like a hard cap.
 */
function warnIfMemoryLimitIgnored(actualMb: number | undefined) {
  if (pool.limitWarned || actualMb === undefined || process.env.PROCESSING_MODE === "inline") return;
  if (actualMb <= memoryMb() * 2 + 64) return;
  pool.limitWarned = true;
  log.warn(
    `Document workers may use up to ${actualMb} MB of heap each, not the ${memoryMb()} MB set by PROCESSING_WORKER_MEMORY_MB, ` +
      "because a --max-old-space-size flag (often set through NODE_OPTIONS) overrides V8's own limit. " +
      "The memory watchdog still enforces PROCESSING_WORKER_MEMORY_MB, but only between its 100 ms checks. Remove that flag for a hard limit.",
  );
}

/** `worker.getHeapStatistics()` needs Node 22.16 or later. Without it only V8's own heap limit applies, so say so once. */
function canWatchMemory(worker: Worker): boolean {
  if (typeof worker.getHeapStatistics === "function") return true;
  if (!pool.watchdogWarned) {
    pool.watchdogWarned = true;
    log.warn(`Node ${process.versions.node} cannot report a worker's memory use, so only V8's heap limit bounds a worker. A crafted file could use far more memory. Run Node 22.16 or later.`);
  }
  return false;
}

function spawn(): Slot {
  const worker = pool.factory();
  worker.unref(); // an idle worker must never keep the server from shutting down
  const slot: Slot = { worker, retired: false, ready: Promise.resolve() };
  pool.total++;
  slot.ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no hello from the worker within ${READY_TIMEOUT_MS / 1000}s`)), READY_TIMEOUT_MS);
    const onMessage = (message: WorkerReady | WorkerResponse) => {
      if ("ready" in message) {
        clearTimeout(timer);
        worker.off("message", onMessage);
        warnIfMemoryLimitIgnored(message.heapLimitMb);
        resolve();
      }
    };
    worker.on("message", onMessage);
    worker.once("error", (err) => (clearTimeout(timer), reject(err)));
    worker.once("exit", (code) => (clearTimeout(timer), reject(new Error(`worker exited with code ${code} before it was ready`))));
  });
  slot.ready.catch(() => undefined); // handled by whoever awaits it; this stops a stray unhandled rejection
  // An 'error' event with no listener would crash the whole process, so there is always one.
  worker.on("error", (err) => log.warn("document worker error", { message: err.message }));
  worker.on("exit", () => retire(slot));
  return slot;
}

function take(): Slot {
  const slot = pool.idle.pop();
  if (slot) {
    clearTimeout(slot.idleTimer);
    return slot;
  }
  return spawn();
}

/** The file's bytes as an ArrayBuffer that can be handed to the worker without copying. */
function transferable(data: Uint8Array): ArrayBuffer {
  const whole = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength;
  return (whole ? data.buffer : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) as ArrayBuffer;
}

function runOn(slot: Slot, request: WorkerRequest): Promise<Analysis> {
  return new Promise<Analysis>((resolve, reject) => {
    const { worker } = slot;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(watchdog);
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
      fn();
    };
    const timer = setTimeout(
      () =>
        finish(() => {
          retire(slot); // it may be stuck for good, so it doesn't get another file
          reject(new DocumentError(TIMEOUT_MESSAGE));
        }),
      timeoutMs(),
    );
    // Heap plus buffers, read from outside the worker, which answers even while the worker is busy decompressing.
    let looking = false;
    const watchdog = canWatchMemory(worker)
      ? setInterval(async () => {
          if (looking || settled) return;
          looking = true;
          try {
            const stats = await worker.getHeapStatistics();
            if (!settled && stats.total_heap_size + stats.external_memory > memoryMb() * 1024 * 1024)
              finish(() => {
                retire(slot);
                reject(new DocumentError(OUT_OF_MEMORY_MESSAGE));
              });
          } catch {
            // The worker has gone away; its exit or error event reports that.
          } finally {
            looking = false;
          }
        }, WATCHDOG_MS)
      : undefined;
    watchdog?.unref();
    function onMessage(message: WorkerReady | WorkerResponse) {
      if ("ready" in message || message.id !== request.id) return;
      finish(() => {
        release(slot);
        if (message.ok) resolve(message.result);
        else reject(message.safe ? new DocumentError(message.message) : new Error(message.message));
      });
    }
    function onError(err: Error & { code?: string }) {
      finish(() => {
        retire(slot);
        reject(err.code === "ERR_WORKER_OUT_OF_MEMORY" ? new DocumentError(OUT_OF_MEMORY_MESSAGE) : err);
      });
    }
    function onExit(code: number) {
      finish(() => {
        retire(slot);
        reject(new Error(`document worker exited unexpectedly (code ${code})`));
      });
    }
    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", onExit);
    worker.postMessage(request, [request.data]);
  });
}

/** Reads one file on a worker thread. Waits its turn if every worker is busy. */
export function analyzeInWorker(data: Uint8Array, kind: DocumentKind, filename: string): Promise<Analysis> {
  return pool.gate.run(async () => {
    const slot = take();
    try {
      await slot.ready;
    } catch (err) {
      retire(slot);
      throw new WorkerStartError(err);
    }
    return runOn(slot, { id: pool.nextId++, data: transferable(data), kind, filename });
  });
}

/**
 * The one entry point for reading a file. Uses a worker thread; if workers can't start on this host it says so
 * loudly and reads files in-process from then on, rather than failing every upload.
 */
export async function analyze(data: Uint8Array, kind: DocumentKind, filename: string): Promise<Analysis> {
  if (process.env.PROCESSING_MODE === "inline" || pool.degraded) return analyzeDocument(data, kind, filename);
  try {
    return await analyzeInWorker(data, kind, filename);
  } catch (err) {
    if (!(err instanceof WorkerStartError)) throw err;
    pool.degraded = true;
    log.error("document workers cannot start here, so files are now read inside the web process. Fix this or set PROCESSING_MODE=inline", err);
    return analyzeDocument(data, kind, filename);
  }
}

export function poolStats() {
  return { workers: pool.total, idle: pool.idle.length, degraded: pool.degraded };
}

/** Stops every worker. For tests and orderly shutdown. */
export async function shutdownPool() {
  const slots = [...pool.idle];
  for (const slot of slots) retire(slot);
  pool.degraded = false;
  pool.limitWarned = false;
  pool.watchdogWarned = false;
}

/** Test hook: start workers some other way (for example a fake, or the real file through a TypeScript loader). */
export function setWorkerFactory(factory: (() => Worker) | null) {
  pool.factory = factory ?? defaultFactory;
}
