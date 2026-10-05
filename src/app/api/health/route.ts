import { NextResponse } from "next/server";
import { brand } from "@/lib/config";
import { db } from "@/lib/db";
import { log } from "@/lib/log";

// Never cached: a load balancer or uptime monitor must see the live state.
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/** Liveness and readiness in one: 200 when the app can reach its database, 503 when it can't. Exposes nothing sensitive. */
export async function GET() {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("database check timed out after 3s")), 3000);
      }),
    ]);
    return NextResponse.json({ status: "ok", version: brand.version, database: "up", latencyMs: Date.now() - started }, { headers: noStore });
  } catch (err) {
    log.error("health check failed", err);
    return NextResponse.json({ status: "unavailable", version: brand.version, database: "down" }, { status: 503, headers: noStore });
  } finally {
    clearTimeout(timer);
  }
}
