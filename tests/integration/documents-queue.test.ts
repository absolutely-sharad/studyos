// Needs a migrated Postgres: TEST_DATABASE_URL=postgresql://... npm test   (skipped without it)
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pdfWithPages } from "../helpers/pdf";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

type Db = typeof import("@/lib/db").db;
let db: Db;
let queue: typeof import("@/lib/documents/queue");
let processing: typeof import("@/lib/documents/process");
let pool: typeof import("@/lib/documents/pool");
let storage: typeof import("@/lib/storage");
let uploadDir: string;
const userIds: string[] = [];

beforeAll(async () => {
  if (!url) return;
  process.env.DATABASE_URL = url;
  uploadDir = await mkdtemp(path.join(tmpdir(), "studyos-queue-"));
  process.env.UPLOAD_DIR = uploadDir;
  db = (await import("@/lib/db")).db;
  queue = await import("@/lib/documents/queue");
  processing = await import("@/lib/documents/process");
  pool = await import("@/lib/documents/pool");
  storage = await import("@/lib/storage");
  // The real worker file, compiled on the fly.
  pool.setWorkerFactory(() => new Worker(new URL("../fixtures/ts-worker.mjs", import.meta.url), { workerData: { entry: new URL("../../src/lib/documents/extract-worker.ts", import.meta.url).href } }));
});

afterEach(async () => {
  if (url) await pool.shutdownPool();
});

afterAll(async () => {
  if (!url) return;
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await rm(uploadDir, { recursive: true, force: true });
  await db.$disconnect();
});

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function seedUser() {
  const user = await db.user.create({ data: { email: `queue-${unique()}@example.com`, name: "Queue test" } });
  userIds.push(user.id);
  const exam = await db.exam.create({
    data: { userId: user.id, name: "Queue exam", category: "CUSTOM", customCategory: "test", examDate: new Date(Date.UTC(2030, 0, 1)), weeklyMinutes: { 0: 60 } },
  });
  return { userId: user.id, examId: exam.id };
}
type Owner = Awaited<ReturnType<typeof seedUser>>;

const SYLLABUS_TEXT = "Unit 1: Arrays, Linked lists, Stacks. Unit 2: Trees and Graph traversal. Syllabus and course outline for the semester examination. ".repeat(6);

/** A waiting document. Pass `bytes` to also put a real file in storage for it. */
async function addDocument(owner: Owner, opts: { name?: string; bytes?: Buffer; status?: "UPLOADED" | "EXTRACTING" | "CHUNKING" | "READY" | "FAILED" | "NEEDS_OCR"; category?: "NOTES" | "SYLLABUS"; categorySource?: "USER" | "NAME"; createdAt?: Date; attempts?: number } = {}) {
  const name = opts.name ?? `doc-${unique()}.pdf`;
  const storageKey = `${owner.userId}/${unique()}-${name}`;
  if (opts.bytes) await storage.saveFile(storageKey, opts.bytes);
  return db.document.create({
    data: {
      examId: owner.examId, userId: owner.userId, filename: name, mimeType: "application/pdf", sizeBytes: opts.bytes?.length ?? 1,
      category: opts.category ?? "NOTES", categorySource: opts.categorySource ?? "NAME", storageKey,
      status: opts.status ?? "UPLOADED", attempts: opts.attempts ?? 0, ...(opts.createdAt && { createdAt: opts.createdAt }),
    },
  });
}

const statusOf = async (id: string) => (await db.document.findUniqueOrThrow({ where: { id } })).status;
const ageBy = (id: string, minutes: number) => db.$executeRaw`UPDATE documents SET "updatedAt" = now() - make_interval(mins => ${minutes}::int) WHERE id = ${id}::uuid`;
/** Claims everything currently waiting so a test starts from an empty queue (other tests' rows are not ours to claim). */
const drainQueue = async () => { for (;;) if ((await queue.claimDocuments(100)).length === 0) return; };

suite("claiming documents from the queue", () => {
  it("takes waiting files, marks them as being read, and never returns the same file twice", async () => {
    await drainQueue();
    const owner = await seedUser();
    const docs = [await addDocument(owner), await addDocument(owner), await addDocument(owner)];
    const first = await queue.claimDocuments(2);
    expect(first).toHaveLength(2);
    for (const id of first) expect(await statusOf(id)).toBe("EXTRACTING");
    const second = await queue.claimDocuments(5);
    expect(second).toHaveLength(1);
    expect(new Set([...first, ...second])).toEqual(new Set(docs.map((d) => d.id)));
    expect(await queue.claimDocuments(5)).toEqual([]);
  });

  it("serves one user's files oldest first", async () => {
    await drainQueue();
    const owner = await seedUser();
    const old = await addDocument(owner, { createdAt: new Date(Date.now() - 60_000) });
    const newer = await addDocument(owner);
    expect(await queue.claimDocuments(1)).toEqual([old.id]);
    expect(await queue.claimDocuments(1)).toEqual([newer.id]);
  });

  it("is fair: everyone's first file goes before anyone's second, so one big upload can't starve the rest", async () => {
    await drainQueue();
    const [heavy, light, other] = [await seedUser(), await seedUser(), await seedUser()];
    const base = Date.now() - 10 * 60_000;
    const heavyDocs: Awaited<ReturnType<typeof addDocument>>[] = [];
    for (let i = 0; i < 5; i++) heavyDocs.push(await addDocument(heavy, { createdAt: new Date(base + i * 1000) })); // arrived first, and there are many
    const lightDoc = await addDocument(light, { createdAt: new Date(base + 6000) });
    const otherDocs = [await addDocument(other, { createdAt: new Date(base + 7000) }), await addDocument(other, { createdAt: new Date(base + 8000) })];
    const firstThree = await queue.claimDocuments(3);
    expect(new Set(firstThree)).toEqual(new Set([heavyDocs[0].id, lightDoc.id, otherDocs[0].id]));
    const nextTwo = await queue.claimDocuments(2); // second turns: heavy's #2 and other's #2
    expect(new Set(nextTwo)).toEqual(new Set([heavyDocs[1].id, otherDocs[1].id]));
  });

  it("stays fair when files are claimed one at a time, which is how the app claims them", async () => {
    await drainQueue();
    const [heavy, light, other] = [await seedUser(), await seedUser(), await seedUser()];
    const base = Date.now() - 10 * 60_000;
    const heavyDocs: Awaited<ReturnType<typeof addDocument>>[] = [];
    for (let i = 0; i < 6; i++) heavyDocs.push(await addDocument(heavy, { createdAt: new Date(base + i * 1000) }));
    const lightDoc = await addDocument(light, { createdAt: new Date(base + 7000) });
    const otherDoc = await addDocument(other, { createdAt: new Date(base + 8000) });
    const order: string[] = [];
    for (let i = 0; i < 8; i++) order.push(...(await queue.claimDocuments(1)));
    const name = (id: string) => (id === lightDoc.id ? "light" : id === otherDoc.id ? "other" : `heavy${heavyDocs.findIndex((d) => d.id === id)}`);
    // A claimed file still counts against its owner, so the students with one file each are not made to wait for all six.
    expect(order.map(name)).toEqual(["heavy0", "light", "other", "heavy1", "heavy2", "heavy3", "heavy4", "heavy5"]);
  });

  it("stays fair in the real processing loop too: the others are started before the heavy uploader's later files", async () => {
    await drainQueue();
    const [heavy, light, other] = [await seedUser(), await seedUser(), await seedUser()];
    const base = Date.now() - 10 * 60_000;
    const pdf = pdfWithPages([SYLLABUS_TEXT]);
    const heavyDocs: Awaited<ReturnType<typeof addDocument>>[] = [];
    for (let i = 0; i < 6; i++) heavyDocs.push(await addDocument(heavy, { bytes: pdf, createdAt: new Date(base + i * 1000) }));
    const lightDoc = await addDocument(light, { bytes: pdf, createdAt: new Date(base + 7000) });
    const otherDoc = await addDocument(other, { bytes: pdf, createdAt: new Date(base + 8000) });
    const real = queue.claimDocuments;
    const claimed: string[] = [];
    const spy = vi.spyOn(queue, "claimDocuments").mockImplementation(async (n) => {
      const got = await real(n);
      claimed.push(...got);
      return got;
    });
    try {
      await processing.processPending();
    } finally {
      spy.mockRestore();
    }
    expect(claimed).toHaveLength(8);
    // Three slots: the first three claims are one file from each student, not three of the heavy uploader's.
    expect(new Set(claimed.slice(0, 3))).toEqual(new Set([heavyDocs[0].id, lightDoc.id, otherDoc.id]));
  });

  it("counts every start of a file, so it can be given up on", async () => {
    await drainQueue();
    const owner = await seedUser();
    const doc = await addDocument(owner);
    await queue.claimDocuments(1);
    expect((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).attempts).toBe(1);
  });

  it("gives up on a file that keeps being abandoned, instead of starting it again after every crash", async () => {
    await drainQueue();
    const owner = await seedUser();
    const doc = await addDocument(owner);
    // Three times the server picks it up and then dies mid-read; each time it is found abandoned 10 minutes later.
    for (let attempt = 1; attempt <= queue.MAX_ATTEMPTS; attempt++) {
      expect(await queue.claimDocuments(1)).toEqual([doc.id]);
      expect((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).attempts).toBe(attempt);
      await ageBy(doc.id, 10);
    }
    // The fourth time it is not started: it is failed, with a message the student can act on.
    expect(await queue.claimDocuments(1)).toEqual([]);
    const done = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(done.status).toBe("FAILED");
    expect(done.error).toBe(queue.GAVE_UP_MESSAGE);
    expect(await queue.claimDocuments(1)).toEqual([]);
  });

  it("still retries a file that was only interrupted once or twice (a deploy, a restart)", async () => {
    await drainQueue();
    const owner = await seedUser();
    const doc = await addDocument(owner, { status: "EXTRACTING", attempts: 2 });
    await ageBy(doc.id, 10);
    expect(await queue.claimDocuments(1)).toEqual([doc.id]);
    expect((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).attempts).toBe(3);
  });

  it("the processing loop leaves a given-up file failed and doesn't read it", async () => {
    await drainQueue();
    const owner = await seedUser();
    const doc = await addDocument(owner, { bytes: pdfWithPages([SYLLABUS_TEXT]), status: "EXTRACTING", attempts: queue.MAX_ATTEMPTS });
    await ageBy(doc.id, 10);
    await processing.processPending();
    const done = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(done).toMatchObject({ status: "FAILED", error: queue.GAVE_UP_MESSAGE });
    expect(await db.documentChunk.count({ where: { documentId: doc.id } })).toBe(0);
  });

  it("leaves finished, failed and scanned files alone", async () => {
    await drainQueue();
    const owner = await seedUser();
    for (const status of ["READY", "FAILED", "NEEDS_OCR"] as const) await addDocument(owner, { status });
    expect(await queue.claimDocuments(10)).toEqual([]);
  });

  it("picks up a file abandoned mid-read (server restarted) but not one another instance is working on right now", async () => {
    await drainQueue();
    const owner = await seedUser();
    const abandoned = await addDocument(owner, { status: "EXTRACTING" });
    const stuckChunking = await addDocument(owner, { status: "CHUNKING" });
    const busyElsewhere = await addDocument(owner, { status: "EXTRACTING" });
    await ageBy(abandoned.id, 10);
    await ageBy(stuckChunking.id, 10);
    await ageBy(busyElsewhere.id, 1);
    const claimed = await queue.claimDocuments(10);
    expect(new Set(claimed)).toEqual(new Set([abandoned.id, stuckChunking.id]));
    expect(await statusOf(abandoned.id)).toBe("EXTRACTING");
    // claiming refreshed it, so a second instance can't take it again straight away
    expect(await queue.claimDocuments(10)).toEqual([]);
  });

  it("doesn't wait for a file another instance is in the middle of claiming: it takes the others", async () => {
    await drainQueue();
    const owner = await seedUser();
    const locked = await addDocument(owner);
    const free = [await addDocument(owner), await addDocument(owner)];
    await db.$transaction(async (tx) => {
      // Another instance's claim in progress: the row is locked until it commits.
      await tx.$queryRaw`SELECT id FROM documents WHERE id = ${locked.id}::uuid FOR UPDATE`;
      const started = performance.now();
      const claimed = await queue.claimDocuments(10);
      expect(performance.now() - started).toBeLessThan(1500); // without SKIP LOCKED this would wait for the transaction to end
      expect(new Set(claimed)).toEqual(new Set(free.map((d) => d.id)));
    });
    expect(await queue.claimDocuments(10)).toEqual([locked.id]); // and it is still waiting its turn afterwards
  });

  it("hands every file to exactly one of many instances claiming at once", async () => {
    await drainQueue();
    const owners = [await seedUser(), await seedUser(), await seedUser()];
    const ids = new Set<string>();
    for (let i = 0; i < 45; i++) ids.add((await addDocument(owners[i % 3])).id);
    const claimedBy = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const mine: string[] = [];
        for (;;) {
          const got = await queue.claimDocuments(2);
          if (got.length === 0) return mine;
          mine.push(...got);
        }
      }),
    );
    const all = claimedBy.flat();
    expect(all).toHaveLength(45); // none lost
    expect(new Set(all).size).toBe(45); // none claimed twice
    expect(new Set(all)).toEqual(ids);
    expect(claimedBy.filter((c) => c.length > 0).length).toBeGreaterThan(1); // the work really was shared
  });
});

suite("processing the queue", () => {
  const syllabusPdf = () => pdfWithPages([SYLLABUS_TEXT, SYLLABUS_TEXT]);

  it("reads a PDF into chunks, records what it is, and marks it ready", async () => {
    await drainQueue();
    const owner = await seedUser();
    const doc = await addDocument(owner, { name: "notes.pdf", bytes: syllabusPdf(), category: "NOTES", categorySource: "NAME" });
    await processing.processPending();
    const done = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(done).toMatchObject({ status: "READY", pageCount: 2, detectedCategory: "SYLLABUS", category: "SYLLABUS", categorySource: "CONTENT", error: null });
    expect(done.detectionNote).toBeTruthy();
    const chunks = await db.documentChunk.findMany({ where: { documentId: doc.id }, orderBy: { chunkIndex: "asc" } });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    expect(new Set(chunks.map((c) => c.pageNumber))).toEqual(new Set([1, 2]));
  });

  it("never overrides a category the student chose, though it still records what it found", async () => {
    await drainQueue();
    const owner = await seedUser();
    const doc = await addDocument(owner, { bytes: syllabusPdf(), category: "NOTES", categorySource: "USER" });
    await processing.processPending();
    expect(await db.document.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ status: "READY", category: "NOTES", categorySource: "USER", detectedCategory: "SYLLABUS" });
  });

  it("flags a scanned PDF instead of storing empty chunks", async () => {
    await drainQueue();
    const owner = await seedUser();
    const doc = await addDocument(owner, { bytes: pdfWithPages(["", ""]) });
    await processing.processPending();
    const done = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(done.status).toBe("NEEDS_OCR");
    expect(done.error).toMatch(/scanned/);
    expect(await db.documentChunk.count({ where: { documentId: doc.id } })).toBe(0);
  });

  it("fails a damaged file with a plain message that doesn't leak parser internals", async () => {
    await drainQueue();
    const owner = await seedUser();
    const doc = await addDocument(owner, { bytes: Buffer.from("%PDF-1.4\nthis is not really a pdf") });
    await processing.processPending();
    const done = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(done.status).toBe("FAILED");
    expect(done.error).toMatch(/couldn't read this file/);
    expect(done.error).not.toMatch(/pdf\.js|Invalid|Error:|at /i);
  });

  it("fails a file that has vanished from storage with a message that says so", async () => {
    await drainQueue();
    const owner = await seedUser();
    const doc = await addDocument(owner); // a row, but no stored file
    await processing.processPending();
    expect(await db.document.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ status: "FAILED", error: expect.stringMatching(/missing from storage/) });
  });

  it("refuses an over-long PDF with the page limit in the message", async () => {
    await drainQueue();
    const owner = await seedUser();
    const doc = await addDocument(owner, { bytes: pdfWithPages(Array(1501).fill("")) });
    await processing.processPending();
    expect(await db.document.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ status: "FAILED", error: expect.stringMatching(/1501 pages/) });
  });

  it("one bad file doesn't stop the good ones queued with it", async () => {
    await drainQueue();
    const [a, b] = [await seedUser(), await seedUser()];
    const good1 = await addDocument(a, { bytes: syllabusPdf() });
    const bad = await addDocument(a, { bytes: Buffer.from("%PDF-1.4\nbroken") });
    const good2 = await addDocument(b, { bytes: syllabusPdf() });
    await processing.processPending();
    expect(await statusOf(good1.id)).toBe("READY");
    expect(await statusOf(bad.id)).toBe("FAILED");
    expect(await statusOf(good2.id)).toBe("READY");
  });

  it("callers share one pass, and each file is read exactly once", async () => {
    await drainQueue();
    const owner = await seedUser();
    const docs = [await addDocument(owner, { bytes: syllabusPdf() }), await addDocument(owner, { bytes: syllabusPdf() })];
    const [p1, p2] = [processing.processPending(), processing.processPending()];
    expect(p1).toBe(p2);
    await Promise.all([p1, p2]);
    for (const d of docs) expect(await statusOf(d.id)).toBe("READY");
    // reading twice would have rewritten the chunks; a single read leaves a consistent set
    const counts = await Promise.all(docs.map((d) => db.documentChunk.count({ where: { documentId: d.id } })));
    expect(counts[0]).toBe(counts[1]);
  });

  it("picks up a file that arrives while a pass is finishing, never leaving it waiting", async () => {
    await drainQueue();
    const owner = await seedUser();
    for (let round = 0; round < 6; round++) {
      const first = await addDocument(owner, { bytes: syllabusPdf() });
      const pass = processing.processPending();
      await new Promise((resolve) => setTimeout(resolve, round * 40)); // vary where in the pass the new file lands
      const late = await addDocument(owner, { bytes: syllabusPdf() });
      await Promise.all([pass, processing.processPending()]);
      expect([await statusOf(first.id), await statusOf(late.id)]).toEqual(["READY", "READY"]);
    }
  });

  it("a small file that arrives while a long one is being read is started at once, not after the long one", async () => {
    await drainQueue();
    const owner = await seedUser();
    const slow = await addDocument(owner, { name: "slow.pdf", bytes: syllabusPdf() });
    const realAnalyze = pool.analyze;
    const spy = vi.spyOn(pool, "analyze").mockImplementation(async (data, kind, filename) => {
      if (filename === "slow.pdf") await new Promise((resolve) => setTimeout(resolve, 3000));
      return realAnalyze(data, kind, filename);
    });
    try {
      const pass = processing.processPending();
      for (let i = 0; i < 100 && (await statusOf(slow.id)) !== "EXTRACTING"; i++) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await statusOf(slow.id)).toBe("EXTRACTING");
      const small = await addDocument(owner, { name: "small.pdf", bytes: syllabusPdf() });
      void processing.processPending(); // what the upload route does after storing the file
      const started = performance.now();
      while ((await statusOf(small.id)) !== "READY" && performance.now() - started < 2500) await new Promise((resolve) => setTimeout(resolve, 25));
      // The small file is finished while the big one is still being read: two slots were free.
      expect(await statusOf(small.id)).toBe("READY");
      expect(await statusOf(slow.id)).toBe("EXTRACTING");
      await pass;
      expect(await statusOf(slow.id)).toBe("READY");
    } finally {
      spy.mockRestore();
    }
  });

  it("a file that arrives in the instant a pass finds the queue empty still gets read (no lost wake-up)", async () => {
    await drainQueue();
    const owner = await seedUser();
    await addDocument(owner, { bytes: syllabusPdf() });
    const real = queue.claimDocuments;
    let empties = 0;
    let late: Awaited<ReturnType<typeof addDocument>> | undefined;
    // The first empty answer comes while the first file is still being read. The second one is the pass's last
    // look at the queue, with nothing in flight: the file lands, and processing is requested, right then.
    const spy = vi.spyOn(queue, "claimDocuments").mockImplementation(async (limit) => {
      const got = await real(limit);
      if (got.length === 0 && ++empties === 2) {
        late = await addDocument(owner, { bytes: syllabusPdf() });
        void processing.processPending();
      }
      return got;
    });
    try {
      await processing.processPending();
    } finally {
      spy.mockRestore();
    }
    expect(late).toBeDefined();
    expect(await statusOf(late!.id)).toBe("READY");
  });

  it("recovers a file abandoned mid-read by a crashed instance", async () => {
    await drainQueue();
    const owner = await seedUser();
    const doc = await addDocument(owner, { bytes: syllabusPdf(), status: "EXTRACTING" });
    await ageBy(doc.id, 10);
    await processing.processPending();
    expect(await statusOf(doc.id)).toBe("READY");
  });

  it("doesn't throw when there is nothing to do, or when the student deleted the file during the read", async () => {
    await drainQueue();
    await expect(processing.processPending()).resolves.toBeUndefined();
    const owner = await seedUser();
    const doc = await addDocument(owner, { bytes: syllabusPdf() });
    const pass = processing.processPending();
    await db.document.deleteMany({ where: { id: doc.id } });
    await expect(pass).resolves.toBeUndefined();
  });

  it("reads inside the web process when PROCESSING_MODE=inline, with the same result", async () => {
    await drainQueue();
    const owner = await seedUser();
    const doc = await addDocument(owner, { bytes: syllabusPdf() });
    process.env.PROCESSING_MODE = "inline";
    try {
      await processing.processPending();
    } finally {
      delete process.env.PROCESSING_MODE;
    }
    expect(await statusOf(doc.id)).toBe("READY");
    expect(pool.poolStats().workers).toBe(0);
  });
});
