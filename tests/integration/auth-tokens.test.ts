import { beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/server/db/prisma";
import {
  consumeAuthToken,
  createAuthToken,
  getAuthTokenStatus,
} from "@/server/services/authTokens";
import { registerBusinessFromToken } from "@/server/services/signup";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("public auth token lifecycle", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("enforces malformed, unknown, expired, wrong-purpose, reused, and concurrent consumption", async () => {
    const { adminUser } = await seedBase({ plan: "BUSINESS" });
    const valid = await createAuthToken({
      userId: adminUser.id,
      email: adminUser.email,
      purpose: "PASSWORD_RESET",
      expiresInMinutes: 60,
    });

    await expect(
      getAuthTokenStatus({
        purpose: "PASSWORD_RESET",
        token: valid.raw,
        requireUser: true,
      }),
    ).resolves.toBe("valid");
    await expect(
      getAuthTokenStatus({ purpose: "REGISTRATION", token: valid.raw, requireUser: true }),
    ).resolves.toBe("invalid");
    await expect(
      consumeAuthToken({ purpose: "REGISTRATION", token: valid.raw }),
    ).rejects.toMatchObject({ message: "tokenInvalid", code: "NOT_FOUND", status: 404 });

    const stillUnused = await prisma.authToken.findUniqueOrThrow({ where: { id: valid.token.id } });
    expect(stillUnused.usedAt).toBeNull();

    const concurrent = await Promise.allSettled([
      consumeAuthToken({ purpose: "PASSWORD_RESET", token: valid.raw }),
      consumeAuthToken({ purpose: "PASSWORD_RESET", token: valid.raw }),
    ]);
    const fulfilled = concurrent.filter((result) => result.status === "fulfilled");
    const rejected = concurrent.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      message: "tokenExpired",
      code: "CONFLICT",
      status: 409,
    });

    await expect(
      getAuthTokenStatus({ purpose: "PASSWORD_RESET", token: valid.raw, requireUser: true }),
    ).resolves.toBe("expired");
    await expect(
      consumeAuthToken({ purpose: "PASSWORD_RESET", token: valid.raw }),
    ).rejects.toMatchObject({ message: "tokenExpired", code: "CONFLICT", status: 409 });

    const expired = await createAuthToken({
      userId: adminUser.id,
      email: adminUser.email,
      purpose: "EMAIL_VERIFY",
      expiresInMinutes: -1,
    });
    await expect(
      getAuthTokenStatus({ purpose: "EMAIL_VERIFY", token: expired.raw, requireUser: true }),
    ).resolves.toBe("expired");
    await expect(
      consumeAuthToken({ purpose: "EMAIL_VERIFY", token: expired.raw }),
    ).rejects.toMatchObject({ message: "tokenExpired", code: "CONFLICT", status: 409 });

    await expect(getAuthTokenStatus({ purpose: "PASSWORD_RESET", token: "short" })).resolves.toBe(
      "invalid",
    );
    await expect(
      consumeAuthToken({ purpose: "PASSWORD_RESET", token: "short" }),
    ).rejects.toMatchObject({ message: "tokenInvalid", code: "NOT_FOUND", status: 404 });
    await expect(
      getAuthTokenStatus({ purpose: "PASSWORD_RESET", token: "unknown-token-value" }),
    ).resolves.toBe("invalid");
    await expect(
      consumeAuthToken({ purpose: "PASSWORD_RESET", token: "unknown-token-value" }),
    ).rejects.toMatchObject({ message: "tokenInvalid", code: "NOT_FOUND", status: 404 });
  });

  it("rolls registration-token consumption back after a validation failure and commits it once", async () => {
    const user = await prisma.user.create({
      data: {
        email: "registration-retry@example.test",
        name: "Registration Retry",
        passwordHash: "test-only-hash",
        role: "ADMIN",
        preferredLocale: "en",
      },
    });
    const registration = await createAuthToken({
      userId: user.id,
      email: user.email,
      purpose: "REGISTRATION",
      expiresInMinutes: 60,
    });

    await expect(
      registerBusinessFromToken({
        token: registration.raw,
        orgName: "Retry Organization",
        storeName: "Retry Store",
        storeCode: "!",
        requestId: "auth-token-invalid-registration",
      }),
    ).rejects.toMatchObject({ message: "invalidStoreCode", code: "BAD_REQUEST", status: 400 });

    await expect(
      prisma.authToken.findUniqueOrThrow({ where: { id: registration.token.id } }),
    ).resolves.toMatchObject({ usedAt: null });
    await expect(prisma.organization.count()).resolves.toBe(0);
    await expect(prisma.store.count()).resolves.toBe(0);

    const completed = await registerBusinessFromToken({
      token: registration.raw,
      orgName: "Retry Organization",
      storeName: "Retry Store",
      storeCode: "RETRY",
      requestId: "auth-token-valid-registration",
    });
    expect(completed).toMatchObject({ userId: user.id });
    await expect(
      prisma.authToken.findUniqueOrThrow({ where: { id: registration.token.id } }),
    ).resolves.toMatchObject({ usedAt: expect.any(Date) });
    await expect(prisma.organization.count()).resolves.toBe(1);
    await expect(prisma.store.count()).resolves.toBe(1);

    await expect(
      registerBusinessFromToken({
        token: registration.raw,
        orgName: "Duplicate Organization",
        storeName: "Duplicate Store",
        storeCode: "DUP",
        requestId: "auth-token-reused-registration",
      }),
    ).rejects.toMatchObject({ message: "tokenExpired", code: "CONFLICT", status: 409 });
    await expect(prisma.organization.count()).resolves.toBe(1);
    await expect(prisma.store.count()).resolves.toBe(1);
  });

  it("commits reset and verification tokens with their domain changes and rolls back failures", async () => {
    const { org, adminUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller();
    const reset = await createAuthToken({
      userId: adminUser.id,
      email: adminUser.email,
      purpose: "PASSWORD_RESET",
      expiresInMinutes: 60,
    });

    await expect(
      caller.publicAuth.resetPassword({
        token: reset.raw,
        password: "Replacement-Password-2026!",
      }),
    ).resolves.toEqual({ reset: true });
    const resetUser = await prisma.user.findUniqueOrThrow({ where: { id: adminUser.id } });
    await expect(
      bcrypt.compare("Replacement-Password-2026!", resetUser.passwordHash),
    ).resolves.toBe(true);
    await expect(
      prisma.authToken.findUniqueOrThrow({ where: { id: reset.token.id } }),
    ).resolves.toMatchObject({ usedAt: expect.any(Date) });
    await expect(
      prisma.auditLog.count({
        where: {
          organizationId: org.id,
          actorId: adminUser.id,
          action: "USER_PASSWORD_RESET",
        },
      }),
    ).resolves.toBe(1);

    const verify = await createAuthToken({
      userId: adminUser.id,
      email: adminUser.email,
      purpose: "EMAIL_VERIFY",
      expiresInMinutes: 60,
    });
    await expect(
      caller.publicAuth.resetPassword({
        token: verify.raw,
        password: "Wrong-Purpose-Password-2026!",
      }),
    ).rejects.toMatchObject({ message: "tokenInvalid", code: "NOT_FOUND" });
    await expect(
      prisma.authToken.findUniqueOrThrow({ where: { id: verify.token.id } }),
    ).resolves.toMatchObject({ usedAt: null });
    await expect(caller.publicAuth.verifyEmail({ token: verify.raw })).resolves.toMatchObject({
      verified: true,
      nextPath: "/login",
      registrationToken: null,
    });
    await expect(
      prisma.authToken.findUniqueOrThrow({ where: { id: verify.token.id } }),
    ).resolves.toMatchObject({ usedAt: expect.any(Date) });
    await expect(caller.publicAuth.verifyEmail({ token: verify.raw })).rejects.toMatchObject({
      message: "tokenExpired",
      code: "CONFLICT",
    });

    const orphan = await createAuthToken({
      userId: null,
      email: "missing-reset-user@example.test",
      purpose: "PASSWORD_RESET",
      expiresInMinutes: 60,
    });
    await expect(
      caller.publicAuth.resetPassword({
        token: orphan.raw,
        password: "Orphan-Password-2026!",
      }),
    ).rejects.toMatchObject({ message: "userNotFound", code: "NOT_FOUND" });
    await expect(
      prisma.authToken.findUniqueOrThrow({ where: { id: orphan.token.id } }),
    ).resolves.toMatchObject({ usedAt: null });
  });
});
