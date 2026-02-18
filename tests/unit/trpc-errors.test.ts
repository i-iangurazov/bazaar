import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportType } from "@prisma/client";

import { AppError } from "@/server/services/errors";
import { toTRPCError } from "@/server/trpc/errors";
import { sanitizeSpreadsheetValue as sanitizeClientSpreadsheetValue } from "@/lib/fileExport";
import { sanitizeSpreadsheetValue as sanitizeServerSpreadsheetValue, toCsv } from "@/server/services/csv";

describe("toTRPCError", () => {
  it("maps AppError code and message", () => {
    const error = new AppError("forbidden", "FORBIDDEN", 403);
    const mapped = toTRPCError(error);

    expect(mapped).toBeInstanceOf(TRPCError);
    expect(mapped.code).toBe("FORBIDDEN");
    expect(mapped.message).toBe("forbidden");
  });

  it("maps too many requests app errors", () => {
    const error = new AppError("rateLimited", "TOO_MANY_REQUESTS", 429);
    const mapped = toTRPCError(error);

    expect(mapped).toBeInstanceOf(TRPCError);
    expect(mapped.code).toBe("TOO_MANY_REQUESTS");
    expect(mapped.message).toBe("rateLimited");
  });

  it("maps infra timeout errors to serviceUnavailable", () => {
    const timeoutError = new Error("connect ETIMEDOUT") as Error & { code?: string };
    timeoutError.code = "ETIMEDOUT";

    const mapped = toTRPCError(timeoutError);

    expect(mapped).toBeInstanceOf(TRPCError);
    expect(mapped.code).toBe("INTERNAL_SERVER_ERROR");
    expect(mapped.message).toBe("serviceUnavailable");
  });

  it("maps unknown errors to genericMessage", () => {
    const mapped = toTRPCError(new Error("unknown boom"));

    expect(mapped).toBeInstanceOf(TRPCError);
    expect(mapped.code).toBe("INTERNAL_SERVER_ERROR");
    expect(mapped.message).toBe("genericMessage");
  });
});

describe("nextauth credentials authorize", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  const createHarness = async () => {
    const findUnique = vi.fn();
    const update = vi.fn();
    const count = vi.fn();
    const consume = vi.fn().mockResolvedValue(undefined);
    const assertLoginAttemptAllowed = vi.fn().mockResolvedValue(undefined);
    const registerLoginFailure = vi.fn().mockResolvedValue(undefined);
    const clearLoginFailures = vi.fn().mockResolvedValue(undefined);
    const logger = { warn: vi.fn(), info: vi.fn() };

    vi.doMock("@/server/db/prisma", () => ({
      prisma: {
        user: { findUnique, update },
        store: { count },
      },
    }));
    vi.doMock("@/server/config/startupChecks", () => ({
      assertStartupConfigured: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("@/server/auth/rateLimiter", () => ({
      loginRateLimiter: { consume },
      assertLoginAttemptAllowed,
      registerLoginFailure,
      clearLoginFailures,
    }));
    vi.doMock("@/server/logging", () => ({
      getLogger: () => logger,
    }));
    vi.doMock("@/server/config/auth", () => ({
      isEmailVerificationRequired: () => true,
    }));
    vi.doMock("@/server/auth/platformOwner", () => ({
      isPlatformOwnerEmail: () => false,
    }));

    const { authOptions } = await import("@/server/auth/nextauth");
    const provider = authOptions.providers[0] as unknown as {
      options?: {
        authorize?: (credentials: unknown, req: unknown) => Promise<unknown> | unknown;
      };
    };
    if (!provider.options?.authorize) {
      throw new Error("missingAuthorize");
    }
    return {
      authorize: provider.options.authorize,
      findUnique,
      count,
      consume,
      assertLoginAttemptAllowed,
      registerLoginFailure,
      clearLoginFailures,
    };
  };

  it("returns null for wrong password on unverified users", async () => {
    const { authorize, findUnique, count, registerLoginFailure } = await createHarness();
    const passwordHash = await bcrypt.hash("CorrectPass123", 10);
    findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@test.local",
      name: "User",
      role: "ADMIN",
      organizationId: "org-1",
      preferredLocale: "ru",
      themePreference: "LIGHT",
      isActive: true,
      isOrgOwner: false,
      emailVerifiedAt: null,
      passwordHash,
    });
    count.mockResolvedValue(1);

    const result = await authorize(
      { email: "user@test.local", password: "WrongPass123" },
      { headers: new Headers([["x-forwarded-for", "127.0.0.1"]]) },
    );

    expect(result).toBeNull();
    expect(registerLoginFailure).toHaveBeenCalledWith({
      email: "user@test.local",
      ip: "127.0.0.1",
    });
  });

  it("throws emailNotVerified only after valid credentials", async () => {
    const { authorize, findUnique, count } = await createHarness();
    const passwordHash = await bcrypt.hash("CorrectPass123", 10);
    findUnique.mockResolvedValue({
      id: "user-2",
      email: "verify@test.local",
      name: "Verify",
      role: "ADMIN",
      organizationId: "org-1",
      preferredLocale: "ru",
      themePreference: "LIGHT",
      isActive: true,
      isOrgOwner: false,
      emailVerifiedAt: null,
      passwordHash,
    });
    count.mockResolvedValue(1);

    let thrown: unknown = null;
    try {
      await authorize(
        { email: "verify@test.local", password: "CorrectPass123" },
        { headers: new Headers([["x-forwarded-for", "127.0.0.1"]]) },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ message: "emailNotVerified" });
  });

  it("returns registrationNotCompleted without embedding token details", async () => {
    const { authorize, findUnique, count } = await createHarness();
    const passwordHash = await bcrypt.hash("CorrectPass123", 10);
    findUnique.mockResolvedValue({
      id: "user-3",
      email: "onboarding@test.local",
      name: "Onboarding",
      role: "ADMIN",
      organizationId: null,
      preferredLocale: "ru",
      themePreference: "LIGHT",
      isActive: true,
      isOrgOwner: false,
      emailVerifiedAt: new Date(),
      passwordHash,
    });
    count.mockResolvedValue(0);

    let thrown: unknown = null;
    try {
      await authorize(
        { email: "onboarding@test.local", password: "CorrectPass123" },
        { headers: new Headers([["x-forwarded-for", "127.0.0.1"]]) },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ message: "registrationNotCompleted" });
  });

  it("uses trusted proxy headers for login limiter keying", async () => {
    const { authorize, findUnique, count, consume } = await createHarness();
    const passwordHash = await bcrypt.hash("CorrectPass123", 10);
    findUnique.mockResolvedValue({
      id: "user-4",
      email: "proxy@test.local",
      name: "Proxy",
      role: "ADMIN",
      organizationId: "org-1",
      preferredLocale: "ru",
      themePreference: "LIGHT",
      isActive: true,
      isOrgOwner: false,
      emailVerifiedAt: new Date(),
      passwordHash,
    });
    count.mockResolvedValue(1);

    await authorize(
      { email: "proxy@test.local", password: "CorrectPass123" },
      {
        headers: new Headers([
          ["x-forwarded-for", "203.0.113.10, 198.51.100.20"],
          ["x-real-ip", "198.51.100.44"],
        ]),
      },
    );

    expect(consume).toHaveBeenCalledWith("proxy@test.local:198.51.100.44");
  });

  it("blocks login when adaptive lockout is active", async () => {
    const { authorize, assertLoginAttemptAllowed, findUnique } = await createHarness();
    assertLoginAttemptAllowed.mockRejectedValue(new Error("loginLocked"));

    let thrown: unknown = null;
    try {
      await authorize(
        { email: "locked@test.local", password: "CorrectPass123" },
        { headers: new Headers([["x-real-ip", "198.51.100.7"]]) },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ message: "loginLocked" });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("clears adaptive failure state after successful login", async () => {
    const { authorize, findUnique, count, clearLoginFailures } = await createHarness();
    const passwordHash = await bcrypt.hash("CorrectPass123", 10);
    findUnique.mockResolvedValue({
      id: "user-5",
      email: "success@test.local",
      name: "Success",
      role: "ADMIN",
      organizationId: "org-1",
      preferredLocale: "ru",
      themePreference: "LIGHT",
      isActive: true,
      isOrgOwner: false,
      emailVerifiedAt: new Date(),
      passwordHash,
    });
    count.mockResolvedValue(1);

    const result = await authorize(
      { email: "success@test.local", password: "CorrectPass123" },
      { headers: new Headers([["x-forwarded-for", "198.51.100.8"]]) },
    );

    expect(result).toMatchObject({ email: "success@test.local" });
    expect(clearLoginFailures).toHaveBeenCalledWith({
      email: "success@test.local",
      ip: "198.51.100.8",
    });
  });
});

describe("nextauth policy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defines explicit jwt session ttl and production cookie policy", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "https://app.example.com");

    const { authOptions } = await import("@/server/auth/nextauth");

    expect(authOptions.session).toMatchObject({
      strategy: "jwt",
      maxAge: 28_800,
      updateAge: 900,
    });
    expect(authOptions.jwt).toMatchObject({ maxAge: 28_800 });
    expect(authOptions.useSecureCookies).toBe(true);
    expect(authOptions.cookies?.sessionToken?.name).toBe("__Secure-next-auth.session-token");
    expect(authOptions.cookies?.sessionToken?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
    });
    expect(authOptions.cookies?.sessionToken?.options).not.toHaveProperty("maxAge");
    expect(authOptions.cookies?.csrfToken?.name).toBe("__Host-next-auth.csrf-token");
  });

  it("falls back to standard cookie names when secure host constraints are not met", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");

    const { authOptions } = await import("@/server/auth/nextauth");

    expect(authOptions.useSecureCookies).toBe(false);
    expect(authOptions.cookies?.sessionToken?.name).toBe("next-auth.session-token");
    expect(authOptions.cookies?.csrfToken?.name).toBe("next-auth.csrf-token");
    expect(authOptions.cookies?.sessionToken?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
    });
  });

  it("limits redirects to same-origin destinations", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "https://app.example.com");
    const { authOptions } = await import("@/server/auth/nextauth");
    const redirect = authOptions.callbacks?.redirect;
    if (!redirect) {
      throw new Error("missingRedirectCallback");
    }

    await expect(
      redirect({
        url: "/dashboard",
        baseUrl: "https://app.example.com",
      }),
    ).resolves.toBe("https://app.example.com/dashboard");
    await expect(
      redirect({
        url: "https://app.example.com/settings/profile",
        baseUrl: "https://app.example.com/auth",
      }),
    ).resolves.toBe("https://app.example.com/settings/profile");
    await expect(
      redirect({
        url: "https://evil.example.com/phishing",
        baseUrl: "https://app.example.com",
      }),
    ).resolves.toBe("https://app.example.com");
  });
});

describe("auth token revalidation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const createTokenHarness = async () => {
    const decodeMock = vi.fn();
    const findUnique = vi.fn();

    vi.doMock("next-auth/jwt", () => ({
      decode: decodeMock,
    }));
    vi.doMock("@/server/db/prisma", () => ({
      prisma: {
        user: { findUnique },
      },
    }));
    vi.doMock("@/server/auth/platformOwner", () => ({
      isPlatformOwnerEmail: (email: string) => email === "owner@test.local",
    }));

    const { getAuthTokenFromCookieHeader } = await import("@/server/auth/token");
    return { getAuthTokenFromCookieHeader, decodeMock, findUnique };
  };

  it("returns null for inactive users even with a valid session token", async () => {
    const { getAuthTokenFromCookieHeader, decodeMock, findUnique } = await createTokenHarness();
    decodeMock.mockResolvedValue({
      sub: "user-1",
      email: "inactive@test.local",
      role: "ADMIN",
      organizationId: "org-1",
    });
    findUnique.mockResolvedValue({
      id: "user-1",
      email: "inactive@test.local",
      name: "Inactive",
      role: "ADMIN",
      organizationId: "org-1",
      isOrgOwner: false,
      isActive: false,
      preferredLocale: "ru",
      themePreference: "LIGHT",
    });

    const token = await getAuthTokenFromCookieHeader("next-auth.session-token=session-token");

    expect(token).toBeNull();
  });

  it("hydrates token claims from current database user state", async () => {
    const { getAuthTokenFromCookieHeader, decodeMock, findUnique } = await createTokenHarness();
    decodeMock.mockResolvedValue({
      sub: "user-2",
      email: "stale@test.local",
      role: "STAFF",
      organizationId: "org-old",
    });
    findUnique.mockResolvedValue({
      id: "user-2",
      email: "owner@test.local",
      name: "Current Owner",
      role: "MANAGER",
      organizationId: "org-2",
      isOrgOwner: true,
      isActive: true,
      preferredLocale: "kg",
      themePreference: "DARK",
    });

    const token = await getAuthTokenFromCookieHeader("__Secure-next-auth.session-token=session-token");

    expect(token).toMatchObject({
      sub: "user-2",
      email: "owner@test.local",
      role: "MANAGER",
      organizationId: "org-2",
      isOrgOwner: true,
      isPlatformOwner: true,
      preferredLocale: "kg",
      themePreference: "DARK",
    });
  });

  it("ignores legacy authjs session cookies after sign-out", async () => {
    const { getAuthTokenFromCookieHeader, decodeMock, findUnique } = await createTokenHarness();

    const token = await getAuthTokenFromCookieHeader("authjs.session-token=legacy-token");

    expect(token).toBeNull();
    expect(decodeMock).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("spreadsheet formula sanitization", () => {
  it("sanitizes dangerous spreadsheet prefixes in server CSV output", () => {
    const csv = toCsv(
      ["name", "notes"],
      [{ name: "=HYPERLINK(\"http://evil\")", notes: "+cmd" }],
      ["name", "notes"],
    );

    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+cmd");
  });

  it("applies consistent sanitization helpers for server and client exports", () => {
    expect(sanitizeServerSpreadsheetValue("@calc")).toBe("'@calc");
    expect(sanitizeClientSpreadsheetValue("-cmd")).toBe("'-cmd");
    expect(sanitizeServerSpreadsheetValue("safe")).toBe("safe");
    expect(sanitizeClientSpreadsheetValue("123")).toBe("123");
  });
});

describe("job lock ownership and renewal", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createJobsHarness = async () => {
    const redisSet = vi.fn();
    const redisEval = vi.fn();
    const redis = {
      set: redisSet,
      eval: redisEval,
    };
    const deadLetterCreate = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const incrementCounter = vi.fn();
    const incrementGauge = vi.fn();
    const decrementGauge = vi.fn();
    const observeHistogram = vi.fn();

    vi.doMock("@/server/redis", () => ({
      getRedisPublisher: () => redis,
    }));
    vi.doMock("@/server/config/runtime", () => ({
      isProductionRuntime: () => false,
    }));
    vi.doMock("@/server/db/prisma", () => ({
      prisma: {
        idempotencyKey: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        deadLetterJob: { create: deadLetterCreate },
      },
    }));
    vi.doMock("@/server/logging", () => ({
      getLogger: () => logger,
    }));
    vi.doMock("@/server/metrics/metrics", () => ({
      incrementCounter,
      incrementGauge,
      decrementGauge,
      observeHistogram,
      jobDurationMs: {} as Record<string, never>,
      jobsCompletedTotal: {} as Record<string, never>,
      jobsFailedTotal: {} as Record<string, never>,
      jobsInflight: {} as Record<string, never>,
      jobsSkippedTotal: {} as Record<string, never>,
      jobsRetriedTotal: {} as Record<string, never>,
      redisOperationDurationMs: {} as Record<string, never>,
      redisOperationsTotal: {} as Record<string, never>,
    }));

    const { runJob, registerJobForTests } = await import("@/server/jobs");
    return { runJob, registerJobForTests, redisSet, redisEval, observeHistogram };
  };

  it("releases locks with compare-delete script using the owner token", async () => {
    const { runJob, registerJobForTests, redisSet, redisEval, observeHistogram } = await createJobsHarness();
    redisSet.mockResolvedValue("OK");
    redisEval.mockResolvedValue(1);
    registerJobForTests("lock-release-job", async () => ({ job: "lock-release-job", status: "ok" }));

    const result = await runJob("lock-release-job");

    expect(result.status).toBe("ok");
    const lockOwnerToken = redisSet.mock.calls[0]?.[1];
    const releaseCall = redisEval.mock.calls.find((call) => String(call[0]).includes('redis.call("del"'));
    expect(releaseCall).toBeDefined();
    expect(releaseCall?.[2]).toBe("job-lock:lock-release-job");
    expect(releaseCall?.[3]).toBe(lockOwnerToken);
    expect(observeHistogram).toHaveBeenCalled();
  });

  it("renews lock ttl while a long-running job is in progress", async () => {
    vi.useFakeTimers();
    const { runJob, registerJobForTests, redisSet, redisEval } = await createJobsHarness();
    redisSet.mockResolvedValue("OK");
    redisEval.mockResolvedValue(1);
    registerJobForTests("lock-renew-job", async () => {
      await new Promise((resolve) => setTimeout(resolve, 210_000));
      return { job: "lock-renew-job", status: "ok" as const };
    });

    const runPromise = runJob("lock-renew-job");
    await vi.advanceTimersByTimeAsync(220_000);
    const result = await runPromise;

    expect(result.status).toBe("ok");
    const renewCall = redisEval.mock.calls.find((call) => String(call[0]).includes('redis.call("pexpire"'));
    expect(renewCall).toBeDefined();
    expect(renewCall?.[2]).toBe("job-lock:lock-renew-job");
  });
});

describe("redis event bus recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createEventBusHarness = async () => {
    const publisher = {
      status: "ready",
      publish: vi.fn(),
      ping: vi.fn(),
      connect: vi.fn(),
    };
    const subscriber = {
      status: "ready",
      subscribe: vi.fn(),
      connect: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    const logger = {
      warn: vi.fn(),
      info: vi.fn(),
    };
    const incrementCounter = vi.fn();

    vi.doMock("@/server/redis", () => ({
      redisConfigured: () => true,
      getRedisPublisher: () => publisher,
      getRedisSubscriber: () => subscriber,
    }));
    vi.doMock("@/server/config/runtime", () => ({
      isProductionRuntime: () => false,
    }));
    vi.doMock("@/server/logging", () => ({
      getLogger: () => logger,
    }));
    vi.doMock("@/server/metrics/metrics", () => ({
      eventsPublishedTotal: {} as Record<string, never>,
      eventsPublishFailuresTotal: {} as Record<string, never>,
      incrementCounter,
    }));

    const globalBus = globalThis as typeof globalThis & {
      __bazaarEventBus?: unknown;
    };
    delete globalBus.__bazaarEventBus;

    const { eventBus } = await import("@/server/events/eventBus");
    return { eventBus, publisher, subscriber, logger };
  };

  it("recovers and resumes redis publish after a transient failure", async () => {
    const { eventBus, publisher, subscriber, logger } = await createEventBusHarness();
    publisher.publish.mockRejectedValueOnce(new Error("redisDown")).mockResolvedValue(1);
    publisher.ping.mockResolvedValue("PONG");
    subscriber.subscribe.mockResolvedValue(undefined);

    const localListener = vi.fn();
    const unsubscribe = eventBus.subscribe(localListener);

    eventBus.publish({
      type: "inventory.updated",
      payload: { storeId: "store-1", productId: "product-1" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(publisher.publish).toHaveBeenCalledTimes(1);

    eventBus.publish({
      type: "inventory.updated",
      payload: { storeId: "store-1", productId: "product-2" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(publisher.publish).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_600);

    eventBus.publish({
      type: "inventory.updated",
      payload: { storeId: "store-1", productId: "product-3" },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(localListener).toHaveBeenCalledTimes(3);
    expect(subscriber.subscribe).toHaveBeenCalled();
    expect(publisher.publish).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith("redis event bus recovered");
    unsubscribe();
  });
});

describe("export storm controls", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  const createExportsHarness = async () => {
    const exportJobFindMany = vi.fn();
    const exportJobCount = vi.fn();
    const exportJobCreate = vi.fn();
    const exportJobFindFirst = vi.fn();
    const exportJobUpdate = vi.fn();
    const storeFindFirst = vi.fn();
    const writeAuditLog = vi.fn();
    const runJob = vi.fn();
    const registerJob = vi.fn();

    vi.doMock("@/server/db/prisma", () => ({
      prisma: {
        exportJob: {
          findMany: exportJobFindMany,
          count: exportJobCount,
          create: exportJobCreate,
          findFirst: exportJobFindFirst,
          update: exportJobUpdate,
        },
        store: { findFirst: storeFindFirst },
      },
    }));
    vi.doMock("@/server/services/audit", () => ({
      writeAuditLog,
    }));
    vi.doMock("@/server/jobs", () => ({
      runJob,
      registerJob,
    }));

    const exportsService = await import("@/server/services/exports");
    return {
      ...exportsService,
      exportJobFindMany,
      exportJobCount,
      exportJobCreate,
      exportJobFindFirst,
      exportJobUpdate,
      storeFindFirst,
    };
  };

  it("caps export list page size to prevent unbounded job queries", async () => {
    const { listExportJobs, exportJobFindMany } = await createExportsHarness();
    exportJobFindMany.mockResolvedValue([]);

    await listExportJobs("org-1", { storeId: "store-1", limit: 5_000 });

    expect(exportJobFindMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", storeId: "store-1" },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  });

  it("rejects new export requests when queue is saturated", async () => {
    const { requestExport, exportJobCount, storeFindFirst, exportJobCreate } = await createExportsHarness();
    exportJobCount.mockResolvedValue(20);

    await expect(
      requestExport({
        organizationId: "org-1",
        storeId: "store-1",
        type: ExportType.PRICE_LIST,
        format: "csv",
        periodStart: new Date("2025-01-01T00:00:00Z"),
        periodEnd: new Date("2025-01-31T23:59:59Z"),
        requestedById: "user-1",
        requestId: "req-1",
      }),
    ).rejects.toMatchObject({ message: "exportQueueBusy", code: "TOO_MANY_REQUESTS" });

    expect(storeFindFirst).not.toHaveBeenCalled();
    expect(exportJobCreate).not.toHaveBeenCalled();
  });

  it("rejects export retries when active queue is saturated", async () => {
    const { retryExportJob, exportJobFindFirst, exportJobCount, exportJobUpdate } = await createExportsHarness();
    exportJobFindFirst.mockResolvedValue({
      id: "job-1",
      organizationId: "org-1",
      status: "FAILED",
    });
    exportJobCount.mockResolvedValue(20);

    await expect(
      retryExportJob({
        organizationId: "org-1",
        jobId: "job-1",
        actorId: "user-1",
        requestId: "req-2",
      }),
    ).rejects.toMatchObject({ message: "exportQueueBusy", code: "TOO_MANY_REQUESTS" });

    expect(exportJobUpdate).not.toHaveBeenCalled();
  });
});
