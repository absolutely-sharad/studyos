import { describe, expect, it } from "vitest";
import { BodyStalledError, BodyTooLargeError, readBody } from "@/lib/documents/read-body";

const limits = { maxBytes: 1024, idleMs: 100, totalMs: 1000 };
const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill);

/** A request whose body is produced by `pull`, plus a record of what the reader did to the stream. */
function requestFrom(pull: (controller: ReadableStreamDefaultController<Uint8Array>, index: number) => Promise<void> | void, options: { cancelNeverFinishes?: boolean } = {}) {
  const seen = { pulls: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await pull(controller, seen.pulls++);
    },
    cancel() {
      seen.cancelled = true;
      // A live network request can take until its own timeout to finish cancelling.
      if (options.cancelNeverFinishes) return new Promise<void>(() => undefined);
    },
  });
  return { request: new Request("http://localhost/upload", { method: "POST", body: stream, duplex: "half" } as RequestInit), seen };
}

describe("readBody", () => {
  it("returns the whole body, in order, however it was chunked", async () => {
    const { request } = requestFrom((c, i) => {
      if (i < 3) c.enqueue(bytes(10, i + 1));
      else c.close();
    });
    const body = await readBody(request, limits);
    expect(body.byteLength).toBe(30);
    expect([...body.slice(0, 10)].every((b) => b === 1) && [...body.slice(10, 20)].every((b) => b === 2) && [...body.slice(20)].every((b) => b === 3)).toBe(true);
  });

  it("returns an empty body for a request without one", async () => {
    expect((await readBody(new Request("http://localhost/x", { method: "POST" }), limits)).byteLength).toBe(0);
  });

  it("gives up on a client that stops sending, and cancels its upload", async () => {
    const { request, seen } = requestFrom(async (c, i) => {
      if (i === 0) c.enqueue(bytes(10));
      else await new Promise(() => undefined); // then silence
    });
    const started = performance.now();
    await expect(readBody(request, limits)).rejects.toBeInstanceOf(BodyStalledError);
    expect(performance.now() - started).toBeGreaterThanOrEqual(90);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(seen.cancelled).toBe(true);
  });

  it("doesn't wait for the stream's cancel to finish: on a real connection that can take minutes", async () => {
    // Found on the real server: the idle limit fired at 15 s but the answer came at 315 s, because the cancel was awaited.
    const { request, seen } = requestFrom(
      async (c, i) => {
        if (i === 0) c.enqueue(bytes(10));
        else await new Promise(() => undefined);
      },
      { cancelNeverFinishes: true },
    );
    const started = performance.now();
    await expect(readBody(request, limits)).rejects.toBeInstanceOf(BodyStalledError);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(seen.cancelled).toBe(true);
  });

  it("gives up on a client that never sends anything at all", async () => {
    const { request } = requestFrom(() => new Promise(() => undefined));
    await expect(readBody(request, limits)).rejects.toBeInstanceOf(BodyStalledError);
  });

  it("gives up on a client that trickles data forever, once the total time is up", async () => {
    const { request, seen } = requestFrom(async (c) => {
      await new Promise((resolve) => setTimeout(resolve, 40)); // never idle for long enough to trip the idle limit
      c.enqueue(bytes(1));
    });
    const started = performance.now();
    await expect(readBody(request, { maxBytes: 1_000_000, idleMs: 100, totalMs: 300 })).rejects.toBeInstanceOf(BodyStalledError);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(seen.cancelled).toBe(true);
  });

  it("refuses a body that turns out larger than allowed, and stops reading it", async () => {
    const { request, seen } = requestFrom((c) => {
      c.enqueue(bytes(512));
    });
    await expect(readBody(request, limits)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(seen.cancelled).toBe(true);
    expect(seen.pulls).toBeLessThan(10); // it did not drain an unbounded stream
  });

  it("accepts a body of exactly the limit", async () => {
    const { request } = requestFrom((c, i) => {
      if (i === 0) c.enqueue(bytes(1024));
      else c.close();
    });
    expect((await readBody(request, limits)).byteLength).toBe(1024);
  });

  it("the result can be parsed as a multipart form, as the upload route does", async () => {
    const form = new FormData();
    form.set("file", new Blob(["hello"], { type: "text/plain" }), "a.txt");
    form.set("category", "AUTO");
    const encoded = new Request("http://localhost/x", { method: "POST", body: form });
    const body = await readBody(encoded, { maxBytes: 10_000, idleMs: 500, totalMs: 2000 });
    const parsed = await new Response(body, { headers: { "content-type": encoded.headers.get("content-type") ?? "" } }).formData();
    expect(parsed.get("category")).toBe("AUTO");
    const file = parsed.get("file") as File;
    expect(file.name).toBe("a.txt");
    expect(await file.text()).toBe("hello");
  });
});
