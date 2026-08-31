import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    authToken: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/server/db/prisma", () => ({ prisma }));
vi.mock("@/server/services/audit", () => ({ writeAuditLog: vi.fn() }));

import { consumeAuthToken, getAuthTokenStatus } from "@/server/services/authTokens";

const now = new Date("2026-08-31T12:00:00.000Z");
const validRecord = {
  type: "PASSWORD_RESET",
  userId: "user-1",
  user: { id: "user-1" },
  usedAt: null,
  expiresAt: new Date("2026-08-31T13:00:00.000Z"),
};

describe("public auth token pre-render status", () => {
  beforeEach(() => {
    prisma.authToken.findUnique.mockReset();
    prisma.authToken.updateMany.mockReset();
    prisma.authToken.create.mockReset();
  });

  it("rejects malformed and unknown tokens without consuming them", async () => {
    await expect(
      getAuthTokenStatus({ purpose: "PASSWORD_RESET", token: "short", now }),
    ).resolves.toBe("invalid");
    expect(prisma.authToken.findUnique).not.toHaveBeenCalled();

    prisma.authToken.findUnique.mockResolvedValueOnce(null);
    await expect(
      getAuthTokenStatus({ purpose: "PASSWORD_RESET", token: "unknown-token-value", now }),
    ).resolves.toBe("invalid");
    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
  });

  it("distinguishes expired/used links and requires a user for sensitive forms", async () => {
    prisma.authToken.findUnique
      .mockResolvedValueOnce({ ...validRecord, expiresAt: new Date("2026-08-31T11:59:59.000Z") })
      .mockResolvedValueOnce({ ...validRecord, usedAt: new Date("2026-08-31T11:00:00.000Z") })
      .mockResolvedValueOnce({ ...validRecord, userId: null, user: null });

    await expect(
      getAuthTokenStatus({ purpose: "PASSWORD_RESET", token: "expired-token-value", now }),
    ).resolves.toBe("expired");
    await expect(
      getAuthTokenStatus({ purpose: "PASSWORD_RESET", token: "consumed-token-value", now }),
    ).resolves.toBe("expired");
    await expect(
      getAuthTokenStatus({
        purpose: "PASSWORD_RESET",
        token: "userless-token-value",
        requireUser: true,
        now,
      }),
    ).resolves.toBe("invalid");
    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
  });

  it("allows a valid matching token without consuming it", async () => {
    prisma.authToken.findUnique.mockResolvedValueOnce(validRecord);
    await expect(
      getAuthTokenStatus({
        purpose: "PASSWORD_RESET",
        token: "valid-reset-token-value",
        requireUser: true,
        now,
      }),
    ).resolves.toBe("valid");
    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
  });

  it("does not accept a valid token for a different workflow", async () => {
    prisma.authToken.findUnique.mockResolvedValueOnce(validRecord);
    await expect(
      getAuthTokenStatus({
        purpose: "REGISTRATION",
        token: "password-token-on-registration",
        requireUser: true,
        now,
      }),
    ).resolves.toBe("invalid");
    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
  });

  it("keeps mutation enforcement authoritative for invalid and expired tokens", async () => {
    prisma.authToken.updateMany.mockResolvedValue({ count: 0 });
    prisma.authToken.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "token-1",
      ...validRecord,
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    await expect(
      consumeAuthToken({ purpose: "PASSWORD_RESET", token: "unknown-token-value" }),
    ).rejects.toMatchObject({ message: "tokenInvalid", code: "NOT_FOUND", status: 404 });
    await expect(
      consumeAuthToken({ purpose: "PASSWORD_RESET", token: "expired-token-value" }),
    ).rejects.toMatchObject({ message: "tokenExpired", code: "CONFLICT", status: 409 });
    expect(prisma.authToken.updateMany).toHaveBeenCalledTimes(2);
  });

  it("claims a valid token with one conditional update before returning it", async () => {
    const claimedAt = new Date("2026-08-31T12:00:01.000Z");
    prisma.authToken.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.authToken.findUnique.mockResolvedValueOnce({
      id: "token-claimed",
      ...validRecord,
      usedAt: claimedAt,
    });

    await expect(
      consumeAuthToken({ purpose: "PASSWORD_RESET", token: "  valid-reset-token-value  " }),
    ).resolves.toMatchObject({ id: "token-claimed", usedAt: claimedAt });
    expect(prisma.authToken.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        type: "PASSWORD_RESET",
        usedAt: null,
        expiresAt: { gte: expect.any(Date) },
      },
      data: { usedAt: expect.any(Date) },
    });
  });
});
