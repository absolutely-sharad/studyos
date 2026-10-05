import { randomBytes, scryptSync } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DUMMY_HASH, hashPassword, MAX_PASSWORD_BYTES, PasswordBusyError, SCRYPT, verifyPassword } from "@/lib/password";

const b64 = (b: Buffer) => b.toString("base64").replace(/=+$/, "");
/** An scrypt hash with arbitrary parameters, built the slow-but-simple way. */
function scryptHash(password: string, ln: number, r: number, p: number, keyLength = 32) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, keyLength, { N: 2 ** ln, r, p, maxmem: 256 * 1024 * 1024 });
  return `$scrypt$ln=${ln},r=${r},p=${p}$${b64(salt)}$${b64(key)}`;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("hashPassword / verifyPassword", () => {
  it("produces a self-describing scrypt hash that verifies", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$scrypt\$ln=15,r=8,p=3\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toEqual({ ok: true, needsRehash: false });
  });

  it("rejects a wrong password, an almost-right one and an empty one", async () => {
    const hash = await hashPassword("Tr0ub4dor&3");
    for (const wrong of ["Tr0ub4dor&4", "tr0ub4dor&3", "Tr0ub4dor&3 ", ""])
      await expect(verifyPassword(wrong, hash)).resolves.toEqual({ ok: false, needsRehash: false });
  });

  it("salts every hash, so equal passwords never look equal", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
    await expect(verifyPassword("same", a)).resolves.toMatchObject({ ok: true });
    await expect(verifyPassword("same", b)).resolves.toMatchObject({ ok: true });
  });

  it("handles non-Latin text and the longest allowed password", async () => {
    const hindi = "पासवर्ड-सुरक्षित-123";
    await expect(verifyPassword(hindi, await hashPassword(hindi))).resolves.toMatchObject({ ok: true });
    const longest = "x".repeat(MAX_PASSWORD_BYTES);
    const hash = await hashPassword(longest);
    await expect(verifyPassword(longest, hash)).resolves.toMatchObject({ ok: true });
    // scrypt reads the whole password, unlike bcrypt's 72 bytes
    await expect(verifyPassword(longest.slice(0, 80), hash)).resolves.toMatchObject({ ok: false });
  });

  it("flags a hash made with weaker or different settings for upgrading, but still accepts the password", async () => {
    for (const [ln, r, p] of [[14, 8, 3], [15, 8, 1], [16, 8, 2]] as const) {
      await expect(verifyPassword("pw", scryptHash("pw", ln, r, p))).resolves.toEqual({ ok: true, needsRehash: true });
      await expect(verifyPassword("nope", scryptHash("pw", ln, r, p))).resolves.toEqual({ ok: false, needsRehash: false });
    }
  });
});

describe("legacy bcrypt hashes", () => {
  it("still verify, and are flagged for upgrading only when the password was right", async () => {
    const legacy = await bcrypt.hash("old-password", 4);
    await expect(verifyPassword("old-password", legacy)).resolves.toEqual({ ok: true, needsRehash: true });
    await expect(verifyPassword("wrong", legacy)).resolves.toEqual({ ok: false, needsRehash: false });
  });

  it("accept every bcrypt prefix variant", async () => {
    const hash = await bcrypt.hash("pw", 4); // $2b$ (bcryptjs)
    for (const prefix of ["$2a$", "$2b$", "$2y$"])
      await expect(verifyPassword("pw", prefix + hash.slice(4))).resolves.toMatchObject({ ok: true });
  });
});

describe("bad or tampered stored values", () => {
  it("never verify and never throw", async () => {
    for (const stored of ["", "plaintext", "$argon2id$v=19$m=1,t=1,p=1$x$y", "$scrypt$", "$scrypt$ln=15,r=8,p=3$!!$??", "$2b$not-a-hash"])
      await expect(verifyPassword("pw", stored)).resolves.toEqual({ ok: false, needsRehash: false });
  });

  it("refuse parameters that would demand huge amounts of memory or time, without computing anything", async () => {
    const salt = b64(randomBytes(16));
    const key = b64(randomBytes(32));
    for (const params of ["ln=25,r=8,p=3", "ln=20,r=16,p=1", "ln=15,r=8,p=0", "ln=15,r=0,p=3", "ln=9,r=8,p=3", "ln=15,r=8,p=99", "ln=15,r=999,p=1"]) {
      const started = performance.now();
      await expect(verifyPassword("pw", `$scrypt$${params}$${salt}$${key}`)).resolves.toEqual({ ok: false, needsRehash: false });
      expect(performance.now() - started).toBeLessThan(50);
    }
  });

  it("refuse a key or salt cut down to a weak length, even though the right password would 'match' its prefix", async () => {
    const hash = await hashPassword("pw");
    const [, , , salt, key] = hash.split("$");
    const keyBytes = Buffer.from(key, "base64");
    const withKey = (bytes: number) => `$scrypt$ln=15,r=8,p=3$${salt}$${b64(keyBytes.subarray(0, bytes))}`;
    for (const bytes of [1, 4, 15]) await expect(verifyPassword("pw", withKey(bytes))).resolves.toEqual({ ok: false, needsRehash: false });
    // Sixteen bytes is the shortest accepted; it verifies and is flagged for a full-length upgrade.
    await expect(verifyPassword("pw", withKey(16))).resolves.toEqual({ ok: true, needsRehash: true });
    await expect(verifyPassword("wrong", withKey(16))).resolves.toMatchObject({ ok: false });
    const shortSalt = `$scrypt$ln=15,r=8,p=3$${b64(randomBytes(4))}$${key}`;
    await expect(verifyPassword("pw", shortSalt)).resolves.toEqual({ ok: false, needsRehash: false });
  });
});

describe("DUMMY_HASH (used when the email isn't registered)", () => {
  it("uses the current parameters, so a missing account costs as much as a wrong password", () => {
    expect(DUMMY_HASH).toMatch(new RegExp(`^\\$scrypt\\$ln=${SCRYPT.ln},r=${SCRYPT.r},p=${SCRYPT.p}\\$`));
    const [, , , salt, key] = DUMMY_HASH.split("$");
    expect(Buffer.from(salt, "base64")).toHaveLength(SCRYPT.saltLength);
    expect(Buffer.from(key, "base64")).toHaveLength(SCRYPT.keyLength);
  });

  it("is a well-formed hash that real passwords don't match", async () => {
    await expect(verifyPassword("anything a person would type", DUMMY_HASH)).resolves.toEqual({ ok: false, needsRehash: false });
  });
});

describe("it stays off the main thread", () => {
  /** Longest gap between 5 ms timer ticks while `work` runs: how long the event loop was frozen. */
  async function longestStall(work: () => Promise<unknown>) {
    let last = performance.now();
    let worst = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      worst = Math.max(worst, now - last - 5);
      last = now;
    }, 5);
    await work();
    clearInterval(timer);
    return worst;
  }

  it("hashing and verifying several passwords at once leaves the event loop responsive", async () => {
    const hash = await hashPassword("warm-up");
    // bcryptjs froze the loop for ~200 ms here. Allow generous noise from a busy CI machine, and a few tries.
    const attempts: number[] = [];
    for (let i = 0; i < 3; i++) {
      attempts.push(await longestStall(() => Promise.all([hashPassword("a"), hashPassword("b"), verifyPassword("warm-up", hash), verifyPassword("x", hash)])));
      if (attempts[i] < 60) return;
    }
    expect.fail(`event loop stalled for ${attempts.map(Math.round).join(", ")} ms`);
  });
});

describe("when the server is already busy", () => {
  async function loadWith(env: Record<string, string>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    return import("@/lib/password");
  }

  it("refuses new checks with PasswordBusyError once one is running and the line is full", async () => {
    const mod = await loadWith({ PASSWORD_HASH_CONCURRENCY: "1", PASSWORD_HASH_QUEUE: "1" });
    const running = mod.hashPassword("one");
    const waiting = mod.hashPassword("two");
    await expect(mod.hashPassword("three")).rejects.toBeInstanceOf(mod.PasswordBusyError);
    await expect(mod.verifyPassword("x", mod.DUMMY_HASH)).rejects.toBeInstanceOf(mod.PasswordBusyError);
    await Promise.all([running, waiting]); // the ones already admitted still finish
    await expect(mod.hashPassword("four")).resolves.toMatch(/^\$scrypt\$/); // and it recovers
  });

  it("a stored value that needs no work is answered even when busy", async () => {
    const mod = await loadWith({ PASSWORD_HASH_CONCURRENCY: "1", PASSWORD_HASH_QUEUE: "0" });
    const running = mod.hashPassword("one");
    await expect(mod.verifyPassword("x", "garbage")).resolves.toEqual({ ok: false, needsRehash: false });
    await running;
  });

  it("exports an error class callers can detect", () => {
    expect(new PasswordBusyError()).toBeInstanceOf(Error);
    expect(new PasswordBusyError().name).toBe("PasswordBusyError");
  });
});
