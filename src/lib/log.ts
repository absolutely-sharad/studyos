/**
 * Minimal structured logger. Production writes one JSON object per line (what Vercel, Datadog,
 * CloudWatch and `docker logs` all parse); development stays readable.
 * Pass ids, never passwords, tokens, emails or file contents.
 */

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = process.env.LOG_LEVEL?.toLowerCase() as Level | undefined;
  if (configured && configured in RANK) return RANK[configured];
  return process.env.NODE_ENV === "production" ? RANK.info : RANK.debug;
}

export function serializeError(err: unknown): Fields {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(err.cause !== undefined && { cause: serializeError(err.cause) }),
    };
  }
  return { message: typeof err === "string" ? err : JSON.stringify(err) };
}

function emit(level: Level, msg: string, fields: Fields = {}) {
  if (RANK[level] < threshold()) return;
  const out = level === "error" || level === "warn" ? console.error : console.log;
  if (process.env.NODE_ENV === "production") {
    out(JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields }));
  } else {
    const extra = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : "";
    out(`[${level}] ${msg}${extra}`);
  }
}

export const log = {
  debug: (msg: string, fields?: Fields) => emit("debug", msg, fields),
  info: (msg: string, fields?: Fields) => emit("info", msg, fields),
  warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
  error: (msg: string, err?: unknown, fields?: Fields) =>
    emit("error", msg, { ...(err !== undefined && { error: serializeError(err) }), ...fields }),
};
