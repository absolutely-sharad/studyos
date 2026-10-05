import { beforeEach, describe, expect, it, vi } from "vitest";

// The gate reads this once, when the route is first loaded: two slots, so one account may hold one of them.
const h = vi.hoisted(() => {
  process.env.UPLOAD_CONCURRENCY = "2";
  return { user: "u1", hits: [] as string[], overAllowance: false, hitOk: true, stored: 0, processed: 0 };
});

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: h.user } }) }));
vi.mock("@/lib/session", () => ({ getActiveExam: async () => ({ id: "exam-1" }) }));
vi.mock("@/lib/db", () => ({
  db: { document: { count: async () => 0, create: async ({ data }: { data: object }) => ({ id: "doc-1", ...data }), findMany: async () => [] } },
}));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  peek: async () => ({ ok: !h.overAllowance, retryAfterSec: 30 }),
  hit: async (_rule: unknown, subject: string) => (h.hits.push(subject), { ok: h.hitOk, retryAfterSec: 30 }),
}));
vi.mock("@/lib/storage", () => ({ saveFile: async () => void h.stored++, deleteStoredFile: async () => undefined }));
vi.mock("@/lib/documents/process", () => ({ processPending: async () => void h.processed++ }));
vi.mock("@/lib/documents/serialize", async (original) => ({ ...(await original<typeof import("@/lib/documents/serialize")>()), toDocumentView: (d: { id: string }) => ({ id: d.id }) }));
// `after` only works inside a real request; here it just runs the callback.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (fn: () => unknown) => void fn() }));

import { POST } from "@/app/api/documents/route";

/** A text-file upload whose body arrives `delayMs` after its headers, like a student on a slow connection. */
function upload(delayMs = 0) {
  const boundary = "xxBOUNDARY";
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      controller.enqueue(enc.encode(head));
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      controller.enqueue(enc.encode("Unit 1: Arrays and linked lists"));
      controller.enqueue(enc.encode(tail));
      controller.close();
    },
  });
  return new Request("http://studyos.test/api/documents", {
    method: "POST",
    body,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    duplex: "half",
  } as RequestInit);
}
const asUser = (id: string, delayMs?: number) => ((h.user = id), POST(upload(delayMs)));

beforeEach(() => {
  Object.assign(h, { user: "u1", hits: [], overAllowance: false, hitOk: true, stored: 0, processed: 0 });
});

describe("POST /api/documents and the upload allowance (100 per 10 minutes)", () => {
  it("counts an accepted upload once, stores it and queues it for reading", async () => {
    const res = await asUser("u1");
    expect(res.status).toBe(201);
    expect(h.hits).toEqual(["u1"]);
    expect(h.stored).toBe(1);
    expect(h.processed).toBe(1);
  });

  it("a student already over the allowance is turned away at once: 429, nothing counted, nothing stored", async () => {
    h.overAllowance = true;
    const res = await asUser("u1");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(h.hits).toEqual([]);
    expect(h.stored).toBe(0);
  });

  it("if the allowance runs out while the upload waits for its slot, it is refused before the body is read", async () => {
    h.hitOk = false;
    const res = await asUser("u1");
    expect(res.status).toBe(429);
    expect(h.stored).toBe(0);
  });

  it("a 'busy, retrying' answer for the account's own limit is not charged to the allowance", async () => {
    // Two slots means one per account, so a second upload from the same student is turned away while the first is still arriving.
    h.user = "u1";
    const first = POST(upload(300));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = await asUser("u1");
    expect(second.status).toBe(503);
    expect(second.headers.get("retry-after")).toBe("3");
    expect(await second.json()).toMatchObject({ error: expect.stringMatching(/retried in a moment/) });
    expect((await first).status).toBe(201);
    expect(h.hits).toEqual(["u1"]); // only the upload that was received
  });

  it("a 'server busy' answer when every slot and every place in line is taken is not charged either", async () => {
    // 2 slots + 8 places in line = 10 uploads in the building; the 11th is told to come back.
    const students = Array.from({ length: 11 }, (_, i) => `s${i}`);
    const results = await Promise.all(
      students.map(async (id, i) => {
        await new Promise((resolve) => setTimeout(resolve, i * 5));
        h.user = id;
        return POST(upload(250));
      }),
    );
    const busy = results.filter((r) => r.status === 503);
    expect(busy).toHaveLength(1);
    expect(busy[0].headers.get("retry-after")).toBe("5");
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(h.hits).toHaveLength(10); // the turned-away student was not charged
  }, 20_000);
});
