import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerAuthToken, mockAssertStartupConfigured, mockGetRedisPublisher, mockRedisPing, prisma } =
  vi.hoisted(() => ({
    mockGetServerAuthToken: vi.fn(),
    mockAssertStartupConfigured: vi.fn(),
    mockGetRedisPublisher: vi.fn(),
    mockRedisPing: vi.fn(),
    prisma: {
      $queryRaw: vi.fn(),
    },
  }));

vi.mock("@/server/auth/token", () => ({
  getServerAuthToken: () => mockGetServerAuthToken(),
}));

vi.mock("@/server/config/startupChecks", () => ({
  assertStartupConfigured: () => mockAssertStartupConfigured(),
}));

vi.mock("@/server/db/prisma", () => ({ prisma }));

vi.mock("@/server/redis", () => ({
  getRedisPublisher: () => mockGetRedisPublisher(),
}));

import { GET as preflightGet } from "../../src/app/api/preflight/route";

describe("api preflight route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("HEALTHCHECK_SECRET", "");
    mockGetServerAuthToken.mockResolvedValue({ sub: "user-1", role: "ADMIN" });
    mockAssertStartupConfigured.mockResolvedValue(undefined);
    mockRedisPing.mockResolvedValue("PONG");
    mockGetRedisPublisher.mockReturnValue({ ping: mockRedisPing });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns unauthorized without health secret or admin access", async () => {
    mockGetServerAuthToken.mockResolvedValue(null);

    const response = await preflightGet(new Request("http://localhost/api/preflight"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ status: "unauthorized" });
  });

  it("returns ready when startup, db, migrations, and redis checks pass", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ ok: 1 }]).mockResolvedValueOnce([{ count: 0 }]);

    const response = await preflightGet(new Request("http://localhost/api/preflight"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      checks: {
        startup: "ok",
        db: "ok",
        migrations: "ok",
        redis: "ok",
      },
      errors: [],
    });
  });

  it("returns not_ready when migrations are pending", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ ok: 1 }]).mockResolvedValueOnce([{ count: 2 }]);

    const response = await preflightGet(new Request("http://localhost/api/preflight"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "not_ready",
      checks: {
        startup: "ok",
        db: "ok",
        migrations: "pending",
      },
      errors: ["migrations:pending"],
    });
  });
});
