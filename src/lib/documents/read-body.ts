/** The client stopped sending, or took too long overall. */
export class BodyStalledError extends Error {
  constructor() {
    super("The request body stalled");
    this.name = "BodyStalledError";
  }
}

/** More bytes arrived than allowed (the declared length can be missing or wrong, so this counts what really came). */
export class BodyTooLargeError extends Error {
  constructor() {
    super("The request body is too large");
    this.name = "BodyTooLargeError";
  }
}

/**
 * Reads a request body into memory, but gives up if no data arrives for `idleMs`, if the whole body takes longer
 * than `totalMs`, or if more than `maxBytes` arrive. `request.formData()` does none of these: a client that sends
 * a few bytes and stops would hold its upload slot until Node's five-minute request timeout.
 */
export async function readBody(request: Request, limits: { maxBytes: number; idleMs: number; totalMs: number }): Promise<Uint8Array<ArrayBuffer>> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  const deadline = performance.now() + limits.totalMs;
  try {
    for (;;) {
      const wait = Math.min(limits.idleMs, deadline - performance.now());
      if (wait <= 0) throw new BodyStalledError();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BodyStalledError()), wait);
      });
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await Promise.race([reader.read(), stalled]);
      } finally {
        clearTimeout(timer);
      }
      if (next.done) break;
      received += next.value.byteLength;
      if (received > limits.maxBytes) throw new BodyTooLargeError();
      chunks.push(next.value);
    }
  } catch (err) {
    // Stop the client's upload instead of leaving the connection half-read.
    await reader.cancel().catch(() => undefined);
    throw err;
  } finally {
    reader.releaseLock?.();
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
