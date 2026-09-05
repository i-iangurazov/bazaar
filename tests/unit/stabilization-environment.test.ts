import { describe, expect, it } from "vitest";
import { assertStabilizationDatabase, stabilizationEnvironment } from "../../scripts/stabilization/environment";

describe("disposable stabilization environment", () => {
  it("cannot inherit application database or live provider credentials", () => {
    const env = stabilizationEnvironment({ DATABASE_URL: "postgresql://production.example/customer", RESEND_API_KEY: "sentinel", R2_SECRET_ACCESS_KEY: "sentinel", STRIPE_SECRET_KEY: "sentinel" });
    expect(() => assertStabilizationDatabase(env)).not.toThrow();
    expect(env.RESEND_API_KEY).toBe("");
    expect(env.R2_SECRET_ACCESS_KEY).toBe("");
    expect(env.STRIPE_SECRET_KEY).toBe("");
  });
  it.each([
    { DATABASE_URL: "postgresql://localhost:5432/inventory" },
    { DATABASE_TEST_URL: "postgresql://127.0.0.1:55432/other" },
    { REDIS_URL: "redis://localhost:6379" },
    { ALLOW_TEST_DB_RESET: "1" },
    { VERCEL_ENV: "production" },
  ])("refuses an unexpected resource or reset flag: %j", (override) => {
    expect(() => assertStabilizationDatabase({ ...stabilizationEnvironment(), ...override })).toThrow();
  });
});
