import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeDocument } from "@/lib/documents/analyze";
import { DocumentError, MAX_PDF_PAGES } from "@/lib/documents/extract";
import { pdfBomb } from "./helpers/bomb";
import { pdfWithPages } from "./helpers/pdf";

// The pool reads these once, when it is first created, so they are set before anything imports it.
vi.hoisted(() => {
  process.env.PROCESSING_CONCURRENCY = "2";
});
import { analyze, analyzeInWorker, poolStats, setWorkerFactory, shutdownPool, WorkerStartError } from "@/lib/documents/pool";

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);

/** The real worker file, compiled on the fly by tsx. */
const realWorker = () => new Worker(fixture("ts-worker.mjs"), { workerData: { entry: new URL("../src/lib/documents/extract-worker.ts", import.meta.url).href } });
const stub = (name: string, options: ConstructorParameters<typeof Worker>[1] = {}) => () => new Worker(fixture(name), options);

const SYLLABUS = ["Unit 1: Arrays, Linked lists, Stacks, Queues", "Unit 2: Trees and Graph traversal", "Syllabus and course outline for the semester examination."]
  .join(" ")
  .repeat(6);
const syllabusPdf = () => pdfWithPages([SYLLABUS, SYLLABUS]);

let created = 0;
const counting = (factory: () => Worker) => () => {
  created++;
  return factory();
};

beforeEach(() => {
  created = 0;
  setWorkerFactory(counting(realWorker));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await shutdownPool();
  setWorkerFactory(null);
});

describe("the worker returns exactly what in-process analysis returns", () => {
  it("for a PDF", async () => {
    const pdf = syllabusPdf();
    const inline = await analyzeDocument(new Uint8Array(pdf), "pdf", "syllabus.pdf");
    const viaWorker = await analyzeInWorker(new Uint8Array(pdf), "pdf", "syllabus.pdf");
    expect(viaWorker).toEqual(inline);
    expect(viaWorker.outcome).toBe("ready");
  });

  it("for plain text, including from a small pooled Buffer that can't be handed over whole", async () => {
    const text = Buffer.from("Unit 1: Arrays\n\nUnit 2: Trees\n\nPrevious year question paper. Maximum marks: 100. Time allowed: 3 hours.");
    const inline = await analyzeDocument(text, "text", "paper.txt");
    const viaWorker = await analyzeInWorker(text, "text", "paper.txt");
    expect(viaWorker).toEqual(inline);
    expect(text.byteLength).toBeGreaterThan(0); // the caller's copy is still intact
  });

  it("for a scanned (blank) PDF, which is reported rather than chunked", async () => {
    const result = await analyzeInWorker(new Uint8Array(pdfWithPages(["", ""])), "pdf", "scan.pdf");
    expect(result).toMatchObject({ outcome: "needs-ocr", pageCount: 2 });
  });
});

describe("workers are reused and limited", () => {
  it("one worker serves jobs one after another", async () => {
    for (let i = 0; i < 3; i++) await analyzeInWorker(new Uint8Array(syllabusPdf()), "pdf", `f${i}.pdf`);
    expect(created).toBe(1);
    expect(poolStats()).toMatchObject({ workers: 1, idle: 1 });
  });

  it("never runs more at once than PROCESSING_CONCURRENCY, however many are queued", async () => {
    let peak = 0;
    const watcher = setInterval(() => (peak = Math.max(peak, poolStats().workers - poolStats().idle)), 2);
    await Promise.all(Array.from({ length: 8 }, (_, i) => analyzeInWorker(new Uint8Array(syllabusPdf()), "pdf", `f${i}.pdf`)));
    clearInterval(watcher);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(2);
    expect(created).toBeLessThanOrEqual(2);
  });

  it("stops idle workers so they don't hold memory forever", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await analyzeInWorker(new Uint8Array(syllabusPdf()), "pdf", "a.pdf");
      expect(poolStats().workers).toBe(1);
      await vi.advanceTimersByTimeAsync(61_000);
      expect(poolStats().workers).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("what students are told when a file can't be read", () => {
  it("a file over the page limit is a DocumentError, so its plain-language message is shown", async () => {
    const err = await analyzeInWorker(new Uint8Array(pdfWithPages(Array(MAX_PDF_PAGES + 1).fill(""))), "pdf", "huge.pdf").catch((e) => e);
    expect(err).toBeInstanceOf(DocumentError);
    expect(err.message).toMatch(/pages\. The limit is/);
    expect(poolStats().workers).toBe(1); // a refused file doesn't cost us the worker
  });

  it("a damaged file is an ordinary error, whose text is only logged, never shown", async () => {
    const err = await analyzeInWorker(new Uint8Array(Buffer.from("%PDF-1.4\nthis is not really a pdf")), "pdf", "broken.pdf").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(DocumentError);
  });

  it("recovers after a damaged file: the next one is read normally", async () => {
    await analyzeInWorker(new Uint8Array(Buffer.from("%PDF-1.4\nbroken")), "pdf", "broken.pdf").catch(() => undefined);
    await expect(analyzeInWorker(new Uint8Array(syllabusPdf()), "pdf", "ok.pdf")).resolves.toMatchObject({ outcome: "ready" });
  });
});

describe("a worker that misbehaves only takes down itself", () => {
  it("gives up on a file after PROCESSING_TIMEOUT_SECONDS and discards the stuck worker", async () => {
    vi.stubEnv("PROCESSING_TIMEOUT_SECONDS", "1");
    setWorkerFactory(counting(stub("silent-worker.mjs")));
    const started = performance.now();
    const err = await analyzeInWorker(new Uint8Array(syllabusPdf()), "pdf", "stuck.pdf").catch((e) => e);
    expect(err).toBeInstanceOf(DocumentError);
    expect(err.message).toMatch(/took too long/);
    expect(performance.now() - started).toBeGreaterThan(900);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(poolStats().workers).toBe(0);

    setWorkerFactory(counting(realWorker)); // and the pool carries on with a fresh worker
    await expect(analyzeInWorker(new Uint8Array(syllabusPdf()), "pdf", "next.pdf")).resolves.toMatchObject({ outcome: "ready" });
  });

  it("survives a worker that crashes mid-file (the process stays up), and the file fails with a plain error", async () => {
    setWorkerFactory(stub("crash-worker.mjs"));
    const err = await analyzeInWorker(new Uint8Array(syllabusPdf()), "pdf", "crash.pdf").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(DocumentError);
    expect(err.message).toMatch(/exited unexpectedly/);
    expect(poolStats().workers).toBe(0);
    setWorkerFactory(counting(realWorker));
    await expect(analyzeInWorker(new Uint8Array(syllabusPdf()), "pdf", "next.pdf")).resolves.toMatchObject({ outcome: "ready" });
  });

  // A global --max-old-space-size (NODE_OPTIONS) overrides the per-worker limit this test relies on.
  const globalHeapFlag = /--max-old-space-size/.test(process.env.NODE_OPTIONS ?? "");
  it.skipIf(globalHeapFlag)("turns running out of memory into a friendly message, and the web process never notices", async () => {
    setWorkerFactory(stub("oom-worker.mjs", { resourceLimits: { maxOldGenerationSizeMb: 32 } }));
    const err = await analyzeInWorker(new Uint8Array(syllabusPdf()), "pdf", "hog.pdf").catch((e) => e);
    expect(err).toBeInstanceOf(DocumentError);
    expect(err.message).toMatch(/too large or complex/);
    expect(poolStats().workers).toBe(0);
  });
});

describe("the memory watchdog (buffers that V8's heap limit doesn't count)", () => {
  it("terminates a worker whose buffers pass the ceiling, with the friendly message, long before it finishes", async () => {
    vi.stubEnv("PROCESSING_WORKER_MEMORY_MB", "200");
    setWorkerFactory(counting(stub("buffer-hog-worker.mjs")));
    const started = performance.now();
    const err = await analyzeInWorker(new Uint8Array(syllabusPdf()), "pdf", "hog.pdf").catch((e) => e);
    expect(err).toBeInstanceOf(DocumentError);
    expect(err.message).toMatch(/too large or complex/);
    expect(poolStats().workers).toBe(0);
    // Left alone the stub would run for about 800 ms and reach 640 MB; the watchdog stops it well short of that.
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("leaves a worker alone while it stays under the ceiling", async () => {
    vi.stubEnv("PROCESSING_WORKER_MEMORY_MB", "4096");
    setWorkerFactory(stub("buffer-hog-worker.mjs"));
    await expect(analyzeInWorker(new Uint8Array(syllabusPdf()), "pdf", "big-but-fine.pdf")).resolves.toMatchObject({ outcome: "needs-ocr" });
    expect(poolStats().workers).toBe(1); // and the worker is kept for the next file
  });

  it("stops a real PDF that is small on disk and enormous once decompressed", async () => {
    const bomb = pdfBomb(150);
    expect(bomb.length).toBeLessThan(400_000); // a harmless-looking file
    vi.stubEnv("PROCESSING_WORKER_MEMORY_MB", "120");
    const err = await analyzeInWorker(new Uint8Array(bomb), "pdf", "bomb.pdf").catch((e) => e);
    expect(err).toBeInstanceOf(DocumentError);
    expect(err.message).toMatch(/too large or complex/);
    expect(poolStats().workers).toBe(0);
    // and the pool is still usable
    vi.unstubAllEnvs();
    await expect(analyzeInWorker(new Uint8Array(syllabusPdf()), "pdf", "ok.pdf")).resolves.toMatchObject({ outcome: "ready" });
  }, 60_000);

  it("says so once when this Node version can't report a worker's memory", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const noStats = () => {
      const worker = realWorker();
      Object.defineProperty(worker, "getHeapStatistics", { value: undefined });
      return worker;
    };
    setWorkerFactory(noStats);
    await analyzeInWorker(new Uint8Array(syllabusPdf()), "pdf", "a.pdf");
    await analyzeInWorker(new Uint8Array(syllabusPdf()), "pdf", "b.pdf");
    const notes = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("cannot report a worker's memory use"));
    expect(notes).toHaveLength(1);
  });
});

describe("the per-worker memory ceiling", () => {
  it("warns once if something else (such as NODE_OPTIONS) is overriding it", async () => {
    vi.stubEnv("PROCESSING_WORKER_MEMORY_MB", "100");
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // The real worker, started without a limit of its own, reports its default ceiling (gigabytes) back to the pool.
    await analyzeInWorker(new Uint8Array(syllabusPdf()), "pdf", "a.pdf");
    await analyzeInWorker(new Uint8Array(syllabusPdf()), "pdf", "b.pdf");
    const warnings = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("PROCESSING_WORKER_MEMORY_MB"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/max-old-space-size/);
  });

  it("stays quiet when the limit is honoured", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("PROCESSING_WORKER_MEMORY_MB", "64");
    setWorkerFactory(stub("silent-worker.mjs")); // reports a 64 MB ceiling
    vi.stubEnv("PROCESSING_TIMEOUT_SECONDS", "1");
    await analyzeInWorker(new Uint8Array(syllabusPdf()), "pdf", "a.pdf").catch(() => undefined);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("PROCESSING_WORKER_MEMORY_MB"))).toHaveLength(0);
  });
});

describe("when workers can't start on this host", () => {
  it("analyzeInWorker says so with WorkerStartError, before the file is touched", async () => {
    setWorkerFactory(stub("dead-worker.mjs"));
    const pdf = new Uint8Array(syllabusPdf());
    await expect(analyzeInWorker(pdf, "pdf", "a.pdf")).rejects.toBeInstanceOf(WorkerStartError);
    expect(pdf.byteLength).toBeGreaterThan(0); // not transferred away
  });

  it("analyze() falls back to reading in-process, logs an error once, and stops trying workers", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setWorkerFactory(counting(stub("dead-worker.mjs")));
    const first = await analyze(new Uint8Array(syllabusPdf()), "pdf", "a.pdf");
    expect(first.outcome).toBe("ready");
    expect(poolStats().degraded).toBe(true);
    const second = await analyze(new Uint8Array(syllabusPdf()), "pdf", "b.pdf");
    expect(second.outcome).toBe("ready");
    expect(created).toBe(1); // no second attempt to start a worker
    expect(error.mock.calls.filter((c) => String(c[0]).includes("document workers cannot start here"))).toHaveLength(1);
  });
});

describe("PROCESSING_MODE=inline", () => {
  it("reads in-process and never starts a worker", async () => {
    vi.stubEnv("PROCESSING_MODE", "inline");
    const result = await analyze(new Uint8Array(syllabusPdf()), "pdf", "a.pdf");
    expect(result.outcome).toBe("ready");
    expect(created).toBe(0);
  });
});
