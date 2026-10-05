import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { availableParallelism } from "node:os";
import { promisify } from "node:util";
import bcrypt from "bcryptjs";
import { QueueFullError, Semaphore } from "@/lib/semaphore";

/**
 * Password hashing that never blocks the web server.
 *
 * New hashes use scrypt, which Node runs on its thread pool, so a burst of sign-ins costs CPU on other cores
 * instead of freezing every request on the main thread (bcryptjs, pure JavaScript, did the latter: one
 * sign-in held the main thread for about 0.4 s). Existing bcrypt hashes still verify and are upgraded to
 * scrypt the next time their owner signs in.
 *
 * Parameters follow the OWASP minimum for scrypt (N=2^15, r=8, p=3: 32 MB and roughly 0.25 s per hash).
 */

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keyLength: number, options: ScryptOptions) => Promise<Buffer>;

export const SCRYPT = { ln: 15, r: 8, p: 3, keyLength: 32, saltLength: 16 } as const;

/** bcrypt ignored everything past 72 bytes. scrypt doesn't, so this now only bounds the work per request. */
export const MAX_PASSWORD_BYTES = 128;

/**
 * A valid hash of a throwaway password, checked when the email isn't registered so that "no such account"
 * takes as long as "wrong password". Must use the current SCRYPT parameters (a test enforces it).
 */
export const DUMMY_HASH = "$scrypt$ln=15,r=8,p=3$ghjXz4XVXq7FfBR7gYxYQQ$PSqWhU1a7Or0Q3Ptf9cck2nEX2kaeUqO2jlzRspn8pM";

/** The server is already hashing as many passwords as it should, and the waiting line is full. Try again shortly. */
export class PasswordBusyError extends Error {
  constructor() {
    super("Too many password checks are already in progress");
    this.name = "PasswordBusyError";
  }
}

// Leave a core (and one thread-pool thread) for everything else: the pool is shared with file reads and DNS.
const concurrency = () => {
  const configured = Number(process.env.PASSWORD_HASH_CONCURRENCY);
  if (Number.isInteger(configured) && configured >= 1) return configured;
  return Math.max(1, Math.min(3, availableParallelism() - 1));
};
const queueLimit = () => {
  const configured = Number(process.env.PASSWORD_HASH_QUEUE);
  return Number.isInteger(configured) && configured >= 0 ? configured : 50;
};
const gate = new Semaphore(concurrency(), queueLimit());

async function gated<T>(job: () => Promise<T>): Promise<T> {
  try {
    return await gate.run(job);
  } catch (err) {
    if (err instanceof QueueFullError) throw new PasswordBusyError();
    throw err;
  }
}

const b64 = (buf: Buffer) => buf.toString("base64").replace(/=+$/, "");
const SCRYPT_FORMAT = /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;
const BCRYPT_FORMAT = /^\$2[aby]\$\d\d\$/;
const MAX_SCRYPT_MEMORY = 256 * 1024 * 1024;

function derive(password: string, salt: Buffer, keyLength: number, ln: number, r: number, p: number) {
  return scryptAsync(password, salt, keyLength, { N: 2 ** ln, r, p, maxmem: MAX_SCRYPT_MEMORY });
}

export function hashPassword(password: string): Promise<string> {
  return gated(async () => {
    const salt = randomBytes(SCRYPT.saltLength);
    const key = await derive(password, salt, SCRYPT.keyLength, SCRYPT.ln, SCRYPT.r, SCRYPT.p);
    return `$scrypt$ln=${SCRYPT.ln},r=${SCRYPT.r},p=${SCRYPT.p}$${b64(salt)}$${b64(key)}`;
  });
}

export interface PasswordCheck {
  ok: boolean;
  /** Right password, but stored with an older algorithm or weaker parameters: save a fresh hash. */
  needsRehash: boolean;
}

export function verifyPassword(password: string, stored: string): Promise<PasswordCheck> {
  const match = SCRYPT_FORMAT.exec(stored);
  if (match) {
    const [ln, r, p] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const salt = Buffer.from(match[4], "base64");
    const expected = Buffer.from(match[5], "base64");
    // A tampered row must not be able to ask for gigabytes of memory, or weaken itself: scrypt output for a
    // shorter length is a prefix of the longer one, so a key cut down to a few bytes would accept wrong passwords.
    const sane =
      ln >= 10 && ln <= 20 && r >= 1 && r <= 16 && p >= 1 && p <= 16 && 128 * 2 ** ln * r <= MAX_SCRYPT_MEMORY &&
      salt.length >= 8 && salt.length <= 64 && expected.length >= 16 && expected.length <= 64;
    if (!sane) return Promise.resolve({ ok: false, needsRehash: false });
    return gated(async () => {
      const actual = await derive(password, salt, expected.length, ln, r, p);
      const ok = actual.length === expected.length && timingSafeEqual(actual, expected);
      return { ok, needsRehash: ok && (ln !== SCRYPT.ln || r !== SCRYPT.r || p !== SCRYPT.p || expected.length !== SCRYPT.keyLength) };
    });
  }
  if (BCRYPT_FORMAT.test(stored)) {
    // Legacy hash. This one still runs on the main thread, but only until its owner next signs in.
    return gated(async () => {
      const ok = await bcrypt.compare(password, stored);
      return { ok, needsRehash: ok };
    });
  }
  return Promise.resolve({ ok: false, needsRehash: false });
}
