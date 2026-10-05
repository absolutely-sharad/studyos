import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, waitMessage } from "@/lib/rate-limit";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("logger", () => {
  async function capture(env: Record<string, string>, fn: (log: typeof import("@/lib/log").log) => void) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const out = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fn((await import("@/lib/log")).log);
    return { out: out.mock.calls.map((c) => String(c[0])), err: err.mock.calls.map((c) => String(c[0])) };
  }

  it("writes one JSON object per line in production", async () => {
    const { err } = await capture({ NODE_ENV: "production" }, (log) => log.error("boom", new Error("bad"), { documentId: "d1" }));
    const line = JSON.parse(err[0]);
    expect(line).toMatchObject({ level: "error", msg: "boom", documentId: "d1", error: { name: "Error", message: "bad" } });
    expect(line.error.stack).toContain("Error: bad");
    expect(new Date(line.time).toString()).not.toBe("Invalid Date");
  });

  it("includes the cause chain", async () => {
    const { err } = await capture({ NODE_ENV: "production" }, (log) => log.error("outer", new Error("outer", { cause: new Error("inner") })));
    expect(JSON.parse(err[0]).error.cause.message).toBe("inner");
  });

  it("drops debug in production but keeps it in development", async () => {
    const prod = await capture({ NODE_ENV: "production" }, (log) => log.debug("noise"));
    expect([...prod.out, ...prod.err]).toHaveLength(0);
    const dev = await capture({ NODE_ENV: "development" }, (log) => log.debug("noise"));
    expect(dev.out[0]).toContain("[debug] noise");
  });

  it("honours LOG_LEVEL", async () => {
    const { out, err } = await capture({ NODE_ENV: "production", LOG_LEVEL: "error" }, (log) => {
      log.info("hidden");
      log.warn("hidden too");
      log.error("shown");
    });
    expect(out).toHaveLength(0);
    expect(err).toHaveLength(1);
  });

  it("copes with a thrown string or object", async () => {
    const { err } = await capture({ NODE_ENV: "production" }, (log) => {
      log.error("a", "just a string");
      log.error("b", { code: 42 });
    });
    expect(JSON.parse(err[0]).error.message).toBe("just a string");
    expect(JSON.parse(err[1]).error.message).toBe('{"code":42}');
  });
});

describe("clientIp", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it("takes the first forwarded address", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" }))).toBe("203.0.113.7");
  });
  it("falls back to x-real-ip, then to a constant", () => {
    expect(clientIp(h({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(h({}))).toBe("unknown");
  });
});

describe("waitMessage", () => {
  it("says a minute for short waits and rounds longer ones up", () => {
    expect(waitMessage({ ok: false, retryAfterSec: 20 })).toBe("Too many attempts. Try again in a minute.");
    expect(waitMessage({ ok: false, retryAfterSec: 61 })).toBe("Too many attempts. Try again in 2 minutes.");
    expect(waitMessage({ ok: false, retryAfterSec: 900 })).toBe("Too many attempts. Try again in 15 minutes.");
  });
});
