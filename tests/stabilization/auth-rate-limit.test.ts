import { createHash, randomUUID } from "node:crypto";
import type { CredentialsConfig } from "next-auth/providers/credentials";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const isolation = vi.hoisted(() => {
  vi.resetModules();
  const prefix = `auth-rate-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  // Real production rate-limit branches, not the NODE_ENV=test / CI bypass.
  // Database/Redis endpoints and credentials remain the forced disposable ones.
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CI", "");
  vi.stubEnv("NEXT_PHASE", "");
  vi.stubEnv("npm_lifecycle_event", "rate-limit-verification");
  vi.stubEnv("REDIS_KEY_PREFIX", prefix);
  return { prefix };
});
// Deployment/storage/email readiness is a distinct boundary. Authentication,
// bcrypt, database identities, Redis, limiter and tRPC middleware are real.
vi.mock("@/server/config/startupChecks", () => ({ assertStartupConfigured: vi.fn() }));

import { prisma } from "@/server/db/prisma";
import { getRedisPublisher } from "@/server/redis";
import { isProductionRuntime, isBuildPhase } from "@/server/config/runtime";
import { createRateLimiter } from "@/server/middleware/rateLimiter";
import { assertLoginAttemptAllowed, clearLoginFailures, registerLoginFailure } from "@/server/auth/rateLimiter";
import { authOptions } from "@/server/auth/nextauth";
import { protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { cleanupCommerceFixtures, commerceContext, createCommerceFixtures, type CommerceFixtures } from "./fixtures";

describe("production-branch authentication and rate limiting with disposable PostgreSQL/Redis", () => {
  let fixture: CommerceFixtures;
  const ownedKeys = new Set<string>();
  const own = (key: string) => { ownedKeys.add(key); return key; };
  const redis = () => getRedisPublisher()!;
  const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 20);
  const loginKeys = (email: string, ip: string) => {
    const emailHash = hash(email.trim().toLowerCase());
    const ipHash = hash(ip.trim() || "unknown");
    return {
      fail: own(`auth:login:fail:user:${emailHash}`),
      pair: own(`auth:login:fail:pair:${emailHash}:${ipHash}`),
      lock: own(`auth:login:lock:user:${emailHash}`),
      backoff: own(`auth:login:backoff:pair:${emailHash}:${ipHash}`),
      attempts: own(`login:${email}:${ip}`),
    };
  };
  const attempt = (role: "ADMIN" | "MANAGER" = "ADMIN", ip = "192.0.2.10") => {
    const input = { email: fixture.tenants.a.users[role].email, ip };
    loginKeys(input.email, input.ip);
    return input;
  };
  const authorize = (input: { email: string; ip: string }, password: string) => {
    const provider = authOptions.providers[0] as CredentialsConfig;
    return provider.options.authorize!({ email: input.email, password }, { headers: { "x-real-ip": input.ip } });
  };

  beforeAll(async () => {
    expect(process.env.NODE_ENV).toBe("production");
    expect(process.env.CI).toBe("");
    expect(isBuildPhase()).toBe(false);
    expect(isProductionRuntime()).toBe(true);
    expect(redis().options.keyPrefix).toBe(`${isolation.prefix}:`);
    expect(await redis().ping()).toBe("PONG");
  });
  beforeEach(async () => { fixture = await createCommerceFixtures(prisma); });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (ownedKeys.size) await redis().del(...ownedKeys);
    ownedKeys.clear();
    if (fixture) await cleanupCommerceFixtures(prisma, fixture);
  });
  afterAll(async () => {
    await redis().quit();
    vi.unstubAllEnvs();
  });

  it("enforces the exact shared threshold across limiter instances and keeps actor buckets independent", async () => {
    const config = { windowMs: 1500, max: 3, prefix: `custom-${randomUUID()}` };
    own(`${config.prefix}:actor-a`); own(`${config.prefix}:actor-b`);
    for (let count = 0; count < 3; count++) await createRateLimiter(config).consume("actor-a");
    await expect(createRateLimiter(config).consume("actor-a")).rejects.toThrow("rateLimited");
    await expect(createRateLimiter(config).consume("actor-b")).resolves.toBeUndefined();
    expect(await redis().get(`${config.prefix}:actor-a`)).toBe("4");
    const ttl = await redis().pttl(`${config.prefix}:actor-a`);
    expect(ttl).toBeGreaterThan(0); expect(ttl).toBeLessThanOrEqual(1500);
  });

  it("expires a fixed window in real Redis without extending it on blocked requests", async () => {
    const config = { windowMs: 400, max: 1, prefix: `expiry-${randomUUID()}` };
    const key = own(`${config.prefix}:actor`);
    const limiter = createRateLimiter(config);
    await limiter.consume("actor");
    await new Promise(resolve => setTimeout(resolve, 150));
    await expect(limiter.consume("actor")).rejects.toThrow("rateLimited");
    const ttl = await redis().pttl(key);
    expect(ttl).toBeGreaterThan(0); expect(ttl).toBeLessThan(330);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, ttl) + 60));
    await expect(limiter.consume("actor")).resolves.toBeUndefined();
    expect(await redis().get(key)).toBe("1");
  });

  it("enforces actual tRPC middleware with CI bypass disabled and isolates authenticated actors and paths", async () => {
    const prefix = `trpc-${randomUUID()}`;
    const limit = rateLimit({ prefix, max: 2, windowMs: 60_000 });
    let entered = 0;
    const scopedRouter = router({
      probe: protectedProcedure.use(limit).query(() => ++entered),
      second: protectedProcedure.use(limit).query(() => ++entered),
    });
    const a = fixture.tenants.a.users.ADMIN;
    const b = fixture.tenants.a.users.MANAGER;
    for (const user of [a, b]) for (const path of ["probe", "second"]) own(`${prefix}:${user.id}:${path}`);
    const first = scopedRouter.createCaller(commerceContext(prisma, a));
    const second = scopedRouter.createCaller(commerceContext(prisma, b));
    await first.probe(); await first.probe();
    await expect(first.probe()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: "rateLimited" });
    expect(entered).toBe(2);
    await expect(second.probe()).resolves.toBe(3);
    await expect(first.second()).resolves.toBe(4);
  });

  it("applies actual credential-login backoff after five failures, then recovers and clears failures on a valid login", async () => {
    const input = attempt();
    const keys = loginKeys(input.email, input.ip);
    for (let count = 0; count < 5; count++) expect(await authorize(input, "wrong-synthetic-password")).toBeNull();
    expect(await redis().get(keys.fail)).toBe("5");
    await expect(authorize(input, fixture.password)).rejects.toThrow("loginBackoff");
    const ttl = await redis().pttl(keys.backoff);
    expect(ttl).toBeGreaterThan(0); expect(ttl).toBeLessThanOrEqual(1000);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, ttl) + 40));
    await expect(authorize(input, fixture.password)).resolves.toMatchObject({ id: fixture.tenants.a.users.ADMIN.id });
    expect(await redis().mget(keys.fail, keys.pair, keys.lock, keys.backoff)).toEqual([null, null, null, null]);
  });

  it("shares the account lock across IPs and normalized email while leaving a different account unaffected", async () => {
    const input = attempt();
    const keys = loginKeys(input.email, input.ip);
    for (let count = 0; count < 10; count++) await registerLoginFailure(input);
    expect(await redis().get(keys.fail)).toBe("10");
    const alternate = { email: ` ${input.email.toUpperCase()} `, ip: "192.0.2.99" };
    loginKeys(alternate.email, alternate.ip);
    await expect(assertLoginAttemptAllowed(alternate)).rejects.toThrow("loginLocked");
    await expect(assertLoginAttemptAllowed(attempt("MANAGER"))).resolves.toBeUndefined();
    const ttl = await redis().pttl(keys.lock);
    expect(ttl).toBeGreaterThan(898_000); expect(ttl).toBeLessThanOrEqual(900_000);
    // Accelerate only this test's key expiration; this verifies Redis recovery,
    // not that the full15-minute real wall-clock window elapsed.
    await redis().pexpire(keys.lock, 50); await redis().pexpire(keys.backoff, 50);
    await new Promise(resolve => setTimeout(resolve, 90));
    await expect(assertLoginAttemptAllowed(input)).resolves.toBeUndefined();
    await clearLoginFailures(input);
  });

  it("denies the sixteenth real successful credential attempt within the minute", async () => {
    const input = attempt();
    for (let count = 0; count < 15; count++) await expect(authorize(input, fixture.password)).resolves.toMatchObject({ id: fixture.tenants.a.users.ADMIN.id });
    await expect(authorize(input, fixture.password)).rejects.toThrow("loginRateLimited");
    await expect(authorize(attempt("MANAGER"), fixture.password)).resolves.toMatchObject({ id: fixture.tenants.a.users.MANAGER.id });
  });

  it("fails closed on an actual Redis per-command INCR error rather than granting unlimited requests", async () => {
    const prefix = `corrupt-${randomUUID()}`;
    await redis().set(own(`${prefix}:actor`), "not-an-integer");
    await expect(createRateLimiter({ prefix, max: 1, windowMs: 60_000 }).consume("actor")).rejects.toThrow("redisUnavailable");
  });

  it("fails closed when the actual login-failure counter is corrupt", async () => {
    const input = attempt();
    const keys = loginKeys(input.email, input.ip);
    await redis().set(keys.fail, "not-an-integer");
    await expect(registerLoginFailure(input)).rejects.toThrow("redisUnavailable");
  });

  it("maps an actual Redis counter failure to a tRPC error before the protected handler executes", async () => {
    const prefix = `unavailable-${randomUUID()}`;
    const user = fixture.tenants.a.users.ADMIN;
    await redis().set(own(`${prefix}:${user.id}:probe`), "not-an-integer");
    const handler = vi.fn(() => "must not run");
    const scopedRouter = router({
      probe: protectedProcedure.use(rateLimit({ prefix, max: 2, windowMs: 60_000 })).query(handler),
    });
    await expect(scopedRouter.createCaller(commerceContext(prisma, user)).probe()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "genericMessage" });
    expect(handler).not.toHaveBeenCalled();
  });
});
