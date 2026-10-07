import { describe, expect, it } from "vitest";
import { withDefaultConnectionParams } from "@/server/db/connection";

describe("database runtime connection", () => {
  it("uses pooler-compatible fresh statements in production while preserving connection settings", () => {
    const url = new URL(withDefaultConnectionParams("postgresql://test:secret@db.invalid/app?sslmode=require&schema=tenant&connect_timeout=12&statement_cache_size=100", true));
    expect(url.searchParams.get("pgbouncer")).toBe("true");
    expect(url.searchParams.get("statement_cache_size")).toBe("0");
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("schema")).toBe("tenant");
    expect(url.searchParams.get("connect_timeout")).toBe("12");
    expect(url.searchParams.get("pool_timeout")).toBe("10");
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
});
