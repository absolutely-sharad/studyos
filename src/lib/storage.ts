// File storage for uploaded study materials.
//   STORAGE_DRIVER=local     (default) a folder on this machine's disk: development, or a single server with a persistent volume
//   STORAGE_DRIVER=supabase  a private Supabase Storage bucket: serverless hosts such as Vercel
// To add S3 or R2, implement `Driver` below and add a case in `driver()`.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** The file isn't in storage. Anything else that goes wrong is a different error: don't tell students their file is gone because storage had a bad minute. */
export class StorageNotFoundError extends Error {
  constructor(key: string) {
    super(`No stored file for key ${key}`);
    this.name = "StorageNotFoundError";
  }
}

interface Driver {
  save(key: string, data: Buffer, contentType: string): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

// ───────────── Local disk ─────────────

const root = () => path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.UPLOAD_DIR || ".uploads");

function resolveKey(key: string) {
  const full = path.resolve(/* turbopackIgnore: true */ root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Invalid storage key");
  return full;
}

const local: Driver = {
  async save(key, data) {
    const full = resolveKey(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  },
  async read(key) {
    try {
      return await readFile(resolveKey(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new StorageNotFoundError(key);
      throw err;
    }
  },
  async remove(key) {
    await rm(resolveKey(key), { force: true });
  },
};

// ───────────── Supabase Storage ─────────────

let supabaseDriver: Driver | undefined;

function supabase(): Driver {
  if (supabaseDriver) return supabaseDriver;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("STORAGE_DRIVER=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET || "studyos-documents";

  // The service-role key bypasses row-level security. It stays on the server: the bucket is private and
  // files only ever leave through /api/documents/[id]/file, which checks ownership first.
  const bucket = async () => {
    const { createClient } = await import("@supabase/supabase-js");
    return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(bucketName);
  };
  const isMissing = (e: { message: string; status?: number; statusCode?: string }) =>
    e.status === 404 || e.statusCode === "404" || /not.?found/i.test(e.message);

  supabaseDriver = {
    async save(key, data, contentType) {
      const { error } = await (await bucket()).upload(key, data, { contentType, upsert: false });
      if (error) throw new Error(`Storage upload failed: ${error.message}`);
    },
    async read(key) {
      const { data, error } = await (await bucket()).download(key);
      if (error) {
        if (isMissing(error as { message: string; status?: number; statusCode?: string })) throw new StorageNotFoundError(key);
        throw new Error(`Storage download failed: ${error.message}`);
      }
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(key) {
      const { error } = await (await bucket()).remove([key]);
      if (error) throw new Error(`Storage delete failed: ${error.message}`);
    },
  };
  return supabaseDriver;
}

function driver(): Driver {
  const name = process.env.STORAGE_DRIVER || "local";
  if (name === "local") return local;
  if (name === "supabase") return supabase();
  throw new Error(`Unknown STORAGE_DRIVER "${name}". Use "local" or "supabase".`);
}

// `async` so a misconfigured driver surfaces as a rejected promise, which callers' `.catch()` handlers see,
// rather than a synchronous throw that skips them.
export async function saveFile(key: string, data: Buffer, contentType = "application/octet-stream") {
  return driver().save(key, data, contentType);
}
export async function readStoredFile(key: string) {
  return driver().read(key);
}
export async function deleteStoredFile(key: string) {
  return driver().remove(key);
}
