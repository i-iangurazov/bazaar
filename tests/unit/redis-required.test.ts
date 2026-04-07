import { afterEach, describe, expect, it, vi } from "vitest";

describe("redis requirements", () => {
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

    expect(() => getRuntimeEnv()).toThrow("AUTH_TRUSTED_PROXY_HOPS must be a non-negative integer.");
  });

  it("allows localhost database in production only when explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/app?schema=public");
    vi.stubEnv("ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION", "true");
    vi.stubEnv("REDIS_URL", "redis://redis.example.com:6379");
    vi.stubEnv("NEXTAUTH_URL", "https://app.example.com");
    vi.stubEnv("JOBS_SECRET", "jobs-secret");
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
    const {
      getRedisPublisher,
      redisConfigured,
      shouldSkipRedisInitialization,
    } = await import("@/server/redis");

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
});
