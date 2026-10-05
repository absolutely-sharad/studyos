import { describe, expect, it } from "vitest";
import { checkEnv } from "@/lib/env";

const good = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@db.example.com:5432/studyos",
  AUTH_SECRET: "x".repeat(40),
  STORAGE_DRIVER: "supabase",
  SUPABASE_URL: "https://abc.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  ANTHROPIC_API_KEY: "sk-ant-test",
};

describe("checkEnv", () => {
  it("accepts a complete production configuration with no warnings", () => {
    expect(checkEnv(good)).toEqual({ errors: [], warnings: [] });
  });

  it("requires DATABASE_URL and AUTH_SECRET", () => {
    const { errors } = checkEnv({ NODE_ENV: "production" });
    expect(errors.join(" ")).toMatch(/DATABASE_URL is not set/);
    expect(errors.join(" ")).toMatch(/AUTH_SECRET is not set/);
  });

  it("rejects a DATABASE_URL that isn't a Postgres URL", () => {
    expect(checkEnv({ ...good, DATABASE_URL: "mysql://u:p@h/db" }).errors[0]).toMatch(/must start with "postgresql:\/\/"/);
    expect(checkEnv({ ...good, DATABASE_URL: "postgres://u:p@h/db" }).errors).toEqual([]);
  });

  it("treats a blank value like a missing one", () => {
    expect(checkEnv({ ...good, AUTH_SECRET: "   " }).errors.join(" ")).toMatch(/AUTH_SECRET is not set/);
  });

  it("rejects a short AUTH_SECRET in production only", () => {
    expect(checkEnv({ ...good, AUTH_SECRET: "short" }).errors.join(" ")).toMatch(/too short/);
    expect(checkEnv({ ...good, NODE_ENV: "development", AUTH_SECRET: "short" }).errors).toEqual([]);
  });

  it("warns when only half of the Google credentials are set", () => {
    const { warnings } = checkEnv({ ...good, AUTH_GOOGLE_ID: "id" });
    expect(warnings.join(" ")).toMatch(/Google sign-in is disabled/);
    expect(checkEnv({ ...good, AUTH_GOOGLE_ID: "id", AUTH_GOOGLE_SECRET: "s" }).warnings).toEqual([]);
  });

  it("validates the storage driver and its credentials", () => {
    expect(checkEnv({ ...good, STORAGE_DRIVER: "ftp" }).errors.join(" ")).toMatch(/must be "local" or "supabase"/);
    const missing = checkEnv({ ...good, SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }).errors.join(" ");
    expect(missing).toMatch(/SUPABASE_URL/);
    expect(missing).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("refuses local storage on serverless hosts, where uploads would silently vanish", () => {
    for (const host of [{ VERCEL: "1" }, { AWS_LAMBDA_FUNCTION_NAME: "fn" }, { NETLIFY: "true" }]) {
      const { errors } = checkEnv({ ...good, STORAGE_DRIVER: "local", ...host });
      expect(errors.join(" ")).toMatch(/loses uploads on serverless/);
    }
  });

  it("only warns about local storage on a normal server, and not at all in development", () => {
    const prod = checkEnv({ ...good, STORAGE_DRIVER: undefined });
    expect(prod.errors).toEqual([]);
    expect(prod.warnings.join(" ")).toMatch(/persistent volume/);
    expect(checkEnv({ ...good, NODE_ENV: "development", STORAGE_DRIVER: "local" }).warnings).toEqual([]);
  });

  it("warns about a bad PROCESSING_CONCURRENCY and a missing AI key", () => {
    expect(checkEnv({ ...good, PROCESSING_CONCURRENCY: "0" }).warnings.join(" ")).toMatch(/PROCESSING_CONCURRENCY/);
    expect(checkEnv({ ...good, PROCESSING_CONCURRENCY: "abc" }).warnings.join(" ")).toMatch(/PROCESSING_CONCURRENCY/);
    expect(checkEnv({ ...good, PROCESSING_CONCURRENCY: "4" }).warnings).toEqual([]);
    expect(checkEnv({ ...good, ANTHROPIC_API_KEY: undefined }).warnings.join(" ")).toMatch(/rule-based/);
  });
});
