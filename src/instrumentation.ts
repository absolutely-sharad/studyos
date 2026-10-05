import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnv } = await import("@/lib/env");
  const { log } = await import("@/lib/log");
  const { errors, warnings } = checkEnv(process.env);
  for (const w of warnings) log.warn(w);
  if (errors.length > 0) {
    for (const e of errors) log.error(`Invalid configuration: ${e}`);
    // Fail fast in production; in development the pages explain what is missing as you hit it.
    if (process.env.NODE_ENV === "production") throw new Error(`Invalid configuration:\n- ${errors.join("\n- ")}`);
    return;
  }
  // Pick up files a restart (or another instance) left waiting, and keep checking.
  const { startQueueSweeper } = await import("@/lib/documents/process");
  startQueueSweeper();
}

/** Every unhandled server error (pages, actions, route handlers) lands in the logs with its digest. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { log } = await import("@/lib/log");
  const digest = (err as { digest?: string }).digest;
  log.error("request failed", err, { method: request.method, path: request.path, route: context.routePath, kind: context.routeType, digest });
};
