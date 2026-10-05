import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { log } from "@/lib/log";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  // Serverless hosts open many short-lived instances; keep each one's pool small there
  // (DATABASE_POOL_MAX=1 or 2 behind a pooler such as Supabase's Supavisor or PgBouncer).
  const max = Number(process.env.DATABASE_POOL_MAX);
  const adapter = new PrismaPg(
    {
      connectionString: process.env.DATABASE_URL ?? "",
      max: Number.isInteger(max) && max >= 1 ? max : 10,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      query_timeout: 60_000,
    },
    {
      // Without these handlers an error on an idle connection (database restart, network blip)
      // becomes an uncaught exception that takes the whole process down.
      onPoolError: (err) => log.error("database pool error", err),
      onConnectionError: (err) => log.error("database connection error", err),
    },
  );
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
