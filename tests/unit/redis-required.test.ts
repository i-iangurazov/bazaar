import { afterEach, describe, expect, it, vi } from "vitest";

describe("redis requirements", () => {
  const stubPreviewBuildEnv = (redisKeyPrefix: string) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@db.example.com:5432/app?schema=public");
    vi.stubEnv("REDIS_URL", "redis://redis.example.com:6379");
    vi.stubEnv("REDIS_KEY_PREFIX", redisKeyPrefix);
    vi.stubEnv("NEXTAUTH_URL", "https://preview.example.com");
    vi.stubEnv("NEXTAUTH_SECRET", "nextauth-secret");
    vi.stubEnv("JOBS_SECRET", "jobs-secret");
    vi.stubEnv("CRON_SECRET", "cron-secret-at-least-16");
    vi.stubEnv("EMAIL_PROVIDER", "log");
    vi.stubEnv("ALLOW_LOG_EMAIL_IN_PRODUCTION", "true");
  };

  const stubHardeningPreviewEnv = () => {
    stubPreviewBuildEnv("bazaar:hardening:b2");
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://preview:preview@preview-db.example.com:5432/bazaar_hardening_preview_b2?schema=public",
    );
    vi.stubEnv("HARDENING_PREVIEW_GUARD", "1");
    vi.stubEnv("HARDENING_PREVIEW_EXPECTED_DATABASE_NAME", "bazaar_hardening_preview_b2");
    vi.stubEnv("HARDENING_PREVIEW_EXPECTED_DATABASE_HOST", "preview-db.example.com");
    vi.stubEnv("HARDENING_EXTERNAL_PROVIDER_MODE", "disabled");
    vi.stubEnv("RUN_DB_TESTS", "0");
    vi.stubEnv("ALLOW_TEST_DB_RESET", "0");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("IMAGE_STORAGE_PROVIDER", "local");
    vi.stubEnv("EXPORT_STORAGE_PROVIDER", "local");
    vi.stubEnv("R2_ACCOUNT_ID", "");
    vi.stubEnv("R2_ACCESS_KEY_ID", "");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "");
    vi.stubEnv("R2_BUCKET_NAME", "");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "");
    vi.stubEnv("R2_ENDPOINT", "");
    vi.stubEnv("O_MARKET_MOCK_API", "1");
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws in production when REDIS_URL is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REDIS_URL", "");

    vi.resetModules();
    const { createRateLimiter } = await import("@/server/middleware/rateLimiter");

    expect(() =>
      createRateLimiter({
        windowMs: 1000,
        max: 1,
        prefix: "test",
      }),
    ).toThrow();

    vi.unstubAllEnvs();
  });

  it("fails build env check when production auth secrets are missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@db.example.com:5432/app?schema=public");
    vi.stubEnv("REDIS_URL", "redis://redis.example.com:6379");
    vi.stubEnv("NEXTAUTH_URL", "https://app.example.com");
    vi.stubEnv("JOBS_SECRET", "jobs-secret");
    vi.stubEnv("CRON_SECRET", "cron-secret-at-least-16");
    vi.stubEnv("NEXTAUTH_SECRET", "");

    vi.resetModules();
    const { assertBuildEnvConfigured } = await import("@/server/config/runtime");

    expect(() => assertBuildEnvConfigured()).toThrow("NEXTAUTH_SECRET is required in production.");
  });

  it("fails env parsing when AUTH_TRUSTED_PROXY_HOPS is invalid", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_TRUSTED_PROXY_HOPS", "not-a-number");

    vi.resetModules();
    const { getRuntimeEnv } = await import("@/server/config/runtime");

    expect(() => getRuntimeEnv()).toThrow(
      "AUTH_TRUSTED_PROXY_HOPS must be a non-negative integer.",
    );
  });

  it("allows localhost database in production only when explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/app?schema=public");
    vi.stubEnv("ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION", "true");
    vi.stubEnv("REDIS_URL", "redis://redis.example.com:6379");
    vi.stubEnv("NEXTAUTH_URL", "https://app.example.com");
    vi.stubEnv("JOBS_SECRET", "jobs-secret");
    vi.stubEnv("CRON_SECRET", "cron-secret-at-least-16");
    vi.stubEnv("NEXTAUTH_SECRET", "nextauth-secret");
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("EMAIL_FROM", "no-reply@example.com");
    vi.stubEnv("RESEND_API_KEY", "resend-key");

    vi.resetModules();
    const { assertBuildEnvConfigured } = await import("@/server/config/runtime");

    expect(() => assertBuildEnvConfigured()).not.toThrow();
  });

  it("skips redis client initialization during production build phase", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("REDIS_URL", "redis://redis.example.com:6379");

    vi.resetModules();
    const { getRedisPublisher, redisConfigured, shouldSkipRedisInitialization } =
      await import("@/server/redis");

    expect(shouldSkipRedisInitialization()).toBe(true);
    expect(redisConfigured()).toBe(false);
    expect(getRedisPublisher()).toBeNull();
  });

  it("uses an in-memory limiter silently during build phase", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("REDIS_URL", "redis://redis.example.com:6379");

    vi.resetModules();
    const { createRateLimiter } = await import("@/server/middleware/rateLimiter");

    const limiter = createRateLimiter({
      windowMs: 1000,
      max: 1,
      prefix: "build-test",
    });

    expect(() => limiter.consume("key")).not.toThrow();
  });

  it("builds a validated Redis key and channel namespace", async () => {
    vi.stubEnv("REDIS_KEY_PREFIX", "bazaar:hardening:b1");
    vi.resetModules();
    const { getRedisKeyPrefix, withRedisKeyPrefix } = await import("@/server/redis");

    expect(getRedisKeyPrefix()).toBe("bazaar:hardening:b1:");
    expect(withRedisKeyPrefix("inventory.events")).toBe("bazaar:hardening:b1:inventory.events");

    vi.stubEnv("REDIS_KEY_PREFIX", "unsafe namespace");
    vi.resetModules();
    const invalidNamespace = await import("@/server/redis");
    expect(() => invalidNamespace.getRedisKeyPrefix()).toThrow("REDIS_KEY_PREFIX");
  });

  it("fails closed when Vercel Preview has no Redis namespace", async () => {
    stubPreviewBuildEnv("");
    vi.resetModules();
    const { assertBuildEnvConfigured } = await import("@/server/config/runtime");

    expect(() => assertBuildEnvConfigured()).toThrow(
      "REDIS_KEY_PREFIX is required for Vercel Preview isolation.",
    );
  });

  it("accepts a validated branch namespace for Vercel Preview", async () => {
    stubPreviewBuildEnv("bazaar:hardening:b1");
    vi.resetModules();
    const { assertBuildEnvConfigured } = await import("@/server/config/runtime");

    expect(assertBuildEnvConfigured().redisKeyPrefix).toBe("bazaar:hardening:b1:");
  });

  it("accepts only the exact isolated hardening Preview environment", async () => {
    stubHardeningPreviewEnv();
    vi.resetModules();
    const { assertBuildEnvConfigured } = await import("@/server/config/runtime");

    const env = assertBuildEnvConfigured();
    expect(env.hardeningPreviewExpectedDatabaseName).toBe("bazaar_hardening_preview_b2");
    expect(env.hardeningExternalProviderMode).toBe("disabled");
  });

  it.each([
    ["VERCEL_ENV", "production", "HARDENING_PREVIEW_GUARD requires VERCEL_ENV=preview."],
    [
      "DATABASE_URL",
      "postgresql://preview:preview@preview-db.example.com:5432/bazaar_production?schema=public",
      "DATABASE_URL does not match the approved hardening Preview database.",
    ],
    [
      "DATABASE_URL",
      "postgresql://preview:preview@production-db.example.com:5432/bazaar_hardening_preview_b2?schema=public",
      "DATABASE_URL host does not match the approved hardening Preview host.",
    ],
    [
      "ALLOW_TEST_DB_RESET",
      "1",
      "Destructive DB test flags must be disabled in hardening Preview runtime.",
    ],
    [
      "RUN_DB_TESTS",
      "1",
      "Destructive DB test flags must be disabled in hardening Preview runtime.",
    ],
    [
      "HARDENING_EXTERNAL_PROVIDER_MODE",
      "mock",
      "HARDENING_EXTERNAL_PROVIDER_MODE must be disabled in hardening Preview.",
    ],
    [
      "RESEND_API_KEY",
      "forbidden-provider-secret",
      "External provider credentials are forbidden in hardening Preview.",
    ],
    [
      "OPENAI_API_KEY",
      "forbidden-provider-secret",
      "External provider credentials are forbidden in hardening Preview.",
    ],
    ["EMAIL_PROVIDER", "resend", "Hardening Preview email must use the local log provider."],
    [
      "IMAGE_STORAGE_PROVIDER",
      "r2",
      "Hardening Preview storage must use the isolated local provider.",
    ],
    [
      "EXPORT_STORAGE_PROVIDER",
      "r2",
      "Hardening Preview exports must use the isolated local provider.",
    ],
    [
      "R2_ACCOUNT_ID",
      "forbidden-r2-account",
      "R2 credentials and endpoints are forbidden in hardening Preview.",
    ],
    ["O_MARKET_MOCK_API", "0", "O_MARKET_MOCK_API=1 is required in hardening Preview."],
  ])("rejects unsafe hardening Preview %s", async (name, value, message) => {
    stubHardeningPreviewEnv();
    vi.stubEnv(name, value);
    vi.resetModules();
    const { assertBuildEnvConfigured } = await import("@/server/config/runtime");

    expect(() => assertBuildEnvConfigured()).toThrow(message);
  });

  it("keeps the hardening guard a no-op when it is disabled", async () => {
    stubPreviewBuildEnv("bazaar:ordinary:preview");
    vi.stubEnv("HARDENING_PREVIEW_GUARD", "0");
    vi.stubEnv("HARDENING_EXTERNAL_PROVIDER_MODE", "live");
    vi.stubEnv("EXPORT_STORAGE_PROVIDER", "r2");
    vi.stubEnv("R2_ACCOUNT_ID", "ordinary-preview-account");
    vi.resetModules();
    const { assertBuildEnvConfigured, assertExternalProviderCallAllowed } =
      await import("@/server/config/runtime");

    expect(() => assertBuildEnvConfigured()).not.toThrow();
    expect(() => assertExternalProviderCallAllowed("test-provider")).not.toThrow();
  });

  it("blocks external provider calls before network execution in hardening Preview", async () => {
    stubHardeningPreviewEnv();
    vi.resetModules();
    const { assertExternalProviderCallAllowed } = await import("@/server/config/runtime");

    expect(() => assertExternalProviderCallAllowed("test-provider")).toThrow(
      "externalProviderDisabled:test-provider",
    );
  });
});
