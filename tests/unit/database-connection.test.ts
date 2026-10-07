import { describe, expect, it } from "vitest";
import { resolveRuntimeDatabaseUrl, withDefaultConnectionParams } from "@/server/db/connection";

describe("database runtime connection", () => {
  it("uses pooler-compatible fresh statements in production while preserving connection settings", () => {
    const url = new URL(withDefaultConnectionParams("postgresql://test:secret@db.invalid/app?sslmode=require&schema=tenant&connect_timeout=12&statement_cache_size=100", true));
    expect(url.searchParams.get("pgbouncer")).toBe("true");
    expect(url.searchParams.get("statement_cache_size")).toBe("0");
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("schema")).toBe("tenant");
    expect(url.searchParams.get("connect_timeout")).toBe("12");
    expect(url.searchParams.get("pool_timeout")).toBe("10");
    expect(url.searchParams.get("connection_limit")).toBe("5");
    expect(url.username).toBe("test");
    expect(url.password).toBe("secret");
  });
  it("keeps local and test cache settings", () => {
    const url = new URL(withDefaultConnectionParams("postgres://test@localhost/app?statement_cache_size=50"));
    expect(url.searchParams.get("statement_cache_size")).toBe("50");
    expect(url.searchParams.has("pgbouncer")).toBe(false);
  });
  it("leaves other connectors and invalid URLs untouched", () => {
    expect(withDefaultConnectionParams("file:local.db", true)).toBe("file:local.db");
    expect(withDefaultConnectionParams("invalid", true)).toBe("invalid");
  });
  it("uses the matching direct Neon connection only in production", () => {
    const env = {
      DATABASE_URL: "postgresql://test@ep-example-pooler.eu.aws.neon.tech/app",
      DATABASE_URL_UNPOOLED: "postgresql://test@ep-example.eu.aws.neon.tech/app",
      VERCEL_ENV: "production",
    };
    expect(resolveRuntimeDatabaseUrl(env)).toBe(env.DATABASE_URL_UNPOOLED);
    expect(resolveRuntimeDatabaseUrl({ ...env, VERCEL_ENV: "development" })).toBe(env.DATABASE_URL);
    expect(() => resolveRuntimeDatabaseUrl({ ...env, DATABASE_URL_UNPOOLED: env.DATABASE_URL_UNPOOLED + "-other" })).toThrow("does not match");
    expect(() => resolveRuntimeDatabaseUrl({ ...env, DATABASE_URL_UNPOOLED: "postgresql://test@ep-other.eu.aws.neon.tech/app" })).toThrow("does not match");
    expect(resolveRuntimeDatabaseUrl({ DATABASE_URL: env.DATABASE_URL, POSTGRES_URL_NON_POOLING: env.DATABASE_URL_UNPOOLED, VERCEL_ENV: "production" })).toBe(env.DATABASE_URL_UNPOOLED);
  });
});
