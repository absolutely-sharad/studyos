// Local-disk storage for development. In production, replace with S3 / Supabase Storage —
// serverless file systems are not persistent.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = () => path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.UPLOAD_DIR || ".uploads");

function resolveKey(key: string) {
  const full = path.resolve(/* turbopackIgnore: true */ root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Invalid storage key");
  return full;
}

export async function saveFile(key: string, data: Buffer) {
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
}

export function readStoredFile(key: string) {
  return readFile(resolveKey(key));
}

export async function deleteStoredFile(key: string) {
  await rm(resolveKey(key), { force: true });
}
