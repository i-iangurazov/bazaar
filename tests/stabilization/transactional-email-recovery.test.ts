import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ reset: vi.fn(), verification: vi.fn() }));
vi.mock("@/server/services/email", () => ({
  sendResetEmail: transport.reset,
  sendVerificationEmail: transport.verification,
  sendInviteEmail: () => {
    throw new Error("Invite send outside this recovery test");
  },
}));

import { prisma } from "@/server/db/prisma";
import { publicAuthRouter } from "@/server/trpc/routers/publicAuth";
import {
  cleanupCommerceFixtures,
  commerceContext,
  createCommerceFixtures,
  type CommerceFixtures,
} from "./fixtures";

describe("transactional auth email recovery and privacy", () => {
  let fixture: CommerceFixtures;
  beforeEach(async () => {
    vi.clearAllMocks();
    fixture = await createCommerceFixtures(prisma);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (!fixture) return;
    const userIds = Object.values(fixture.tenants).flatMap((tenant) =>
      Object.values(tenant.users).map((user) => user.id),
    );
    await prisma.authToken.deleteMany({ where: { userId: { in: userIds } } });
    await cleanupCommerceFixtures(prisma, fixture);
  });

  it("redacts a failed reset send and permits a later usable reset without disclosing account existence", async () => {
    const user = fixture.tenants.a.users.ADMIN;
    const context = commerceContext(prisma, null);
    const warn = vi.spyOn(context.logger, "warn").mockImplementation(() => undefined);
    const caller = publicAuthRouter.createCaller(context);
    let failedLink = "";
    transport.reset.mockImplementationOnce(async (input: { email: string; resetLink: string }) => {
      failedLink = input.resetLink;
      throw Object.assign(new Error(`provider echoed ${input.email} ${input.resetLink}`), {
        responseText: input.resetLink,
      });
    });
    const failureResponse = await caller.requestPasswordReset({ email: user.email });
    expect(failureResponse).toEqual({ sent: true });
    expect(
      await caller.requestPasswordReset({ email: `${fixture.prefix}-unknown@example.test` }),
    ).toEqual(failureResponse);
    const logged = JSON.stringify(warn.mock.calls);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(logged).not.toContain(user.email);
    expect(logged).not.toContain(failedLink);
    expect(logged).not.toContain("provider echoed");
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      passwordHash: user.passwordHash,
      sessionVersion: user.sessionVersion,
    });

    transport.reset.mockResolvedValueOnce(undefined);
    expect(await caller.requestPasswordReset({ email: user.email })).toEqual(failureResponse);
    const retryLink = transport.reset.mock.calls.at(-1)![0].resetLink as string;
    expect(retryLink).not.toBe(failedLink);
    const token = new URL(retryLink).pathname.split("/").at(-1)!;
    expect(await caller.resetPassword({ token, password: "RecoveredSynthetic123!" })).toEqual({
      reset: true,
    });
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare("RecoveredSynthetic123!", updated.passwordHash)).toBe(true);
    expect(updated.sessionVersion).toBe(user.sessionVersion + 1);
    expect(
      await prisma.authToken.count({
        where: { userId: user.id, type: "PASSWORD_RESET", usedAt: null },
      }),
    ).toBe(0);
  });

  it("returns a safe retryable verification-send error and verifies using the next captured link", async () => {
    const user = fixture.tenants.a.users.ADMIN;
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
    const caller = publicAuthRouter.createCaller(commerceContext(prisma, null));
    let failedLink = "";
    transport.verification.mockImplementationOnce(async (input: { verifyLink: string }) => {
      failedLink = input.verifyLink;
      throw new Error(`provider body ${input.verifyLink}`);
    });
    await expect(caller.resendVerification({ email: user.email })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "emailDeliveryFailed",
    });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      emailVerifiedAt: null,
    });
    transport.verification.mockResolvedValueOnce(undefined);
    expect(await caller.resendVerification({ email: user.email })).toEqual({ sent: true });
    const retryLink = transport.verification.mock.calls.at(-1)![0].verifyLink as string;
    expect(retryLink).not.toBe(failedLink);
    const token = new URL(retryLink).pathname.split("/").at(-1)!;
    expect(await caller.verifyEmail({ token })).toMatchObject({ verified: true });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt,
    ).toBeInstanceOf(Date);
  });
});
