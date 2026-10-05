import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => {
  const objects = new Map<string, Buffer>();
  const calls: { op: string; key?: string; opts?: unknown }[] = [];
  const bucket = {
    upload: vi.fn(async (key: string, data: Buffer, opts: unknown) => {
      calls.push({ op: "upload", key, opts });
      if (key.startsWith("fail/")) return { error: { message: "quota exceeded" } };
      objects.set(key, data);
      return { error: null };
    }),
    download: vi.fn(async (key: string) => {
      calls.push({ op: "download", key });
      if (key.startsWith("outage/")) return { data: null, error: { message: "upstream timeout", status: 503 } };
      const body = objects.get(key);
      if (!body) return { data: null, error: { message: "Object not found", status: 400, statusCode: "404" } };
      return { data: new Blob([new Uint8Array(body)]), error: null };
    }),
    remove: vi.fn(async (keys: string[]) => {
      calls.push({ op: "remove", key: keys[0] });
      for (const k of keys) objects.delete(k);
      return { error: null };
    }),
  };
  return { objects, calls, bucket, createClient: vi.fn(() => ({ storage: { from: vi.fn(() => bucket) } })) };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: supabase.createClient }));

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "studyos-storage-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of ["STORAGE_DRIVER", "UPLOAD_DIR", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_STORAGE_BUCKET"]) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  return import("@/lib/storage");
}

describe("local driver", () => {
  it("round-trips a file and removes it", async () => {
    const s = await load({ UPLOAD_DIR: dir });
    await s.saveFile("user-1/a.pdf", Buffer.from("hello"));
    expect((await s.readStoredFile("user-1/a.pdf")).toString()).toBe("hello");
    await s.deleteStoredFile("user-1/a.pdf");
    await expect(s.readStoredFile("user-1/a.pdf")).rejects.toBeInstanceOf(s.StorageNotFoundError);
  });

  it("reports a missing file as StorageNotFoundError, not a generic error", async () => {
    const s = await load({ UPLOAD_DIR: dir });
    await expect(s.readStoredFile("nobody/none.pdf")).rejects.toMatchObject({ name: "StorageNotFoundError" });
  });

  it("deleting a file that is already gone is not an error", async () => {
    const s = await load({ UPLOAD_DIR: dir });
    await expect(s.deleteStoredFile("nobody/none.pdf")).resolves.toBeUndefined();
  });

  it("refuses keys that escape the upload folder", async () => {
    const s = await load({ UPLOAD_DIR: dir });
    for (const key of ["../outside.txt", "a/../../outside.txt", "/etc/passwd"]) {
      await expect(s.saveFile(key, Buffer.from("x"))).rejects.toThrow(/Invalid storage key/);
      await expect(s.readStoredFile(key)).rejects.toThrow(/Invalid storage key/);
    }
    expect(await readdir(path.dirname(dir)).then((f) => f.includes("outside.txt"))).toBe(false);
  });

  it("is the default driver", async () => {
    const s = await load({ UPLOAD_DIR: dir });
    await s.saveFile("default/x.txt", Buffer.from("x"));
    expect(supabase.createClient).not.toHaveBeenCalled();
  });
});

describe("supabase driver", () => {
  const env = { STORAGE_DRIVER: "supabase", SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key" };
  beforeEach(() => {
    supabase.objects.clear();
    supabase.calls.length = 0;
    supabase.createClient.mockClear();
  });

  it("uploads with the content type, never overwriting, and reads back", async () => {
    const s = await load(env);
    await s.saveFile("u/doc.pdf", Buffer.from("pdf-bytes"), "application/pdf");
    expect(supabase.calls[0]).toEqual({ op: "upload", key: "u/doc.pdf", opts: { contentType: "application/pdf", upsert: false } });
    expect((await s.readStoredFile("u/doc.pdf")).toString()).toBe("pdf-bytes");
  });

  it("uses the service key without persisting a session", async () => {
    const s = await load(env);
    await s.saveFile("u/doc.pdf", Buffer.from("x"));
    expect(supabase.createClient).toHaveBeenCalledWith("https://abc.supabase.co", "service-key", { auth: { persistSession: false, autoRefreshToken: false } });
  });

  it("maps a missing object to StorageNotFoundError but surfaces an outage as a real error", async () => {
    const s = await load(env);
    await expect(s.readStoredFile("u/missing.pdf")).rejects.toBeInstanceOf(s.StorageNotFoundError);
    const outage = await s.readStoredFile("outage/x.pdf").catch((e) => e);
    expect(outage).toBeInstanceOf(Error);
    expect(outage).not.toBeInstanceOf(s.StorageNotFoundError);
    expect(outage.message).toMatch(/upstream timeout/);
  });

  it("throws when an upload fails, so the caller doesn't record a file that isn't there", async () => {
    const s = await load(env);
    await expect(s.saveFile("fail/x.pdf", Buffer.from("x"))).rejects.toThrow(/quota exceeded/);
  });

  it("removes files", async () => {
    const s = await load(env);
    await s.saveFile("u/gone.pdf", Buffer.from("x"));
    await s.deleteStoredFile("u/gone.pdf");
    expect(supabase.objects.has("u/gone.pdf")).toBe(false);
  });

  it("explains what is missing when credentials aren't set", async () => {
    const s = await load({ STORAGE_DRIVER: "supabase" });
    await expect(s.saveFile("u/x", Buffer.from("x"))).rejects.toThrow(/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("driver selection", () => {
  it("rejects an unknown driver instead of silently using the disk", async () => {
    const s = await load({ STORAGE_DRIVER: "ftp" });
    await expect(s.saveFile("u/x", Buffer.from("x"))).rejects.toThrow(/Unknown STORAGE_DRIVER "ftp"/);
  });
});
