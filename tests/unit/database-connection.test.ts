import { describe, expect, it } from "vitest";
import { resolveMigrationDatabaseUrl, resolveRuntimeDatabaseUrl, withDefaultConnectionParams } from "@/server/db/connection";

describe("database runtime connection", () => {
  it("uses pooler-compatible fresh statements in production while preserving connection settings", () => {
    const url = new URL(withDefaultConnectionParams("postgresql://test:secret@db.invalid/app?sslmode=require&schema=tenant&connect_timeout=12&statement_cache_size=100", true));
    expect(url.searchParams.get("pgbouncer")).toBe("true");
    expect(url.searchParams.get("statement_cache_size")).toBe("0");
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("schema")).toBe("tenant");
    expect(url.searchParams.get("connect_timeout")).toBe("12");
    expect(url.searchParams.get("pool_timeout")).toBe("10");
    expect(url.searchParams.get("connection_limit")).toBe("2");
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
  it("keeps runtime on the pooled endpoint when direct migration credentials exist", () => {
    const env = {
      DATABASE_URL: "postgresql://test@ep-example-pooler.eu.aws.neon.tech/app",
      DATABASE_URL_UNPOOLED: "postgresql://test@ep-example.eu.aws.neon.tech/app",
      VERCEL_ENV: "production",
    };
    expect(resolveRuntimeDatabaseUrl(env)).toBe(env.DATABASE_URL);
    expect(resolveMigrationDatabaseUrl(env)).toBe(env.DATABASE_URL_UNPOOLED);
    expect(resolveRuntimeDatabaseUrl({ ...env, VERCEL_ENV: "development" })).toBe(env.DATABASE_URL);
    expect(() => resolveMigrationDatabaseUrl({ ...env, DATABASE_URL_UNPOOLED: env.DATABASE_URL_UNPOOLED + "-other" })).toThrow("does not match");
    expect(() => resolveMigrationDatabaseUrl({ ...env, DATABASE_URL_UNPOOLED: "postgresql://test@ep-other.eu.aws.neon.tech/app" })).toThrow("does not match");
    expect(resolveMigrationDatabaseUrl({ DATABASE_URL: env.DATABASE_URL, POSTGRES_URL_NON_POOLING: env.DATABASE_URL_UNPOOLED })).toBe(env.DATABASE_URL_UNPOOLED);
  });
  it("routes even an explicitly direct production Neon URL through its matching pooler", () => {
    const direct = "postgresql://app:p%40ss@ep-example.c-4.us-east-1.aws.neon.tech:5432/app?sslmode=require&schema=tenant&connect_timeout=12";
    const runtime = new URL(resolveRuntimeDatabaseUrl({ DATABASE_URL: direct, VERCEL_ENV: "production" })!);
    expect(runtime.hostname).toBe("ep-example-pooler.c-4.us-east-1.aws.neon.tech");
    expect(runtime.username).toBe("app");
    expect(runtime.password).toBe("p%40ss");
    expect(runtime.port).toBe("5432");
    expect(runtime.pathname).toBe("/app");
    expect(runtime.search).toBe(new URL(direct).search);
    expect(resolveMigrationDatabaseUrl({ DATABASE_URL: runtime.toString() })).toBe(direct);
    expect(resolveRuntimeDatabaseUrl({ DATABASE_URL: direct, VERCEL_ENV: "preview" })).toBe(direct);
  });
  it("preserves explicit pool sizes and non-Neon endpoints", () => {
    const databaseUrl = "postgresql://test@127.0.0.1:6432/app?connection_limit=1";
    expect(resolveRuntimeDatabaseUrl({ DATABASE_URL: databaseUrl, VERCEL_ENV: "production" })).toBe(databaseUrl);
    expect(resolveMigrationDatabaseUrl({ DATABASE_URL: databaseUrl })).toBe(databaseUrl);
    expect(new URL(withDefaultConnectionParams(databaseUrl, true)).searchParams.get("connection_limit")).toBe("1");
    const lookalike = "postgresql://test@ep-example.neon.tech.attacker.invalid/app";
    expect(resolveRuntimeDatabaseUrl({ DATABASE_URL: lookalike, VERCEL_ENV: "production" })).toBe(lookalike);
    expect(resolveRuntimeDatabaseUrl({ VERCEL_ENV: "production" })).toBeUndefined();
    expect(resolveMigrationDatabaseUrl({})).toBeUndefined();
  });
});
