import bcrypt from "bcryptjs";
import type { CredentialsConfig } from "next-auth/providers/credentials";
import { encode } from "next-auth/jwt";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const email = vi.hoisted(() => ({ verification: vi.fn(), reset: vi.fn(), invite: vi.fn() }));
vi.mock("@/server/services/email", () => ({
  sendVerificationEmail: email.verification,
  sendResetEmail: email.reset,
  sendInviteEmail: email.invite,
}));
vi.mock("@/server/config/startupChecks", () => ({ assertStartupConfigured: vi.fn() }));
vi.mock("@/server/auth/rateLimiter", () => ({
  clearLoginFailures: vi.fn(),
  registerLoginFailure: vi.fn(),
  assertLoginAttemptAllowed: vi.fn(),
  loginRateLimiter: { consume: vi.fn() },
}));

import { prisma } from "@/server/db/prisma";
import { publicAuthRouter } from "@/server/trpc/routers/publicAuth";
import { invitesRouter } from "@/server/trpc/routers/invites";
import { usersRouter } from "@/server/trpc/routers/users";
import { createAuthToken, consumeAuthToken } from "@/server/services/authTokens";
import { authOptions } from "@/server/auth/nextauth";
import { getAuthTokenFromCookieHeader } from "@/server/auth/token";
import { createContext } from "@/server/trpc/trpc";
import { storesRouter } from "@/server/trpc/routers/stores";
import {
  cleanupCommerceFixtures,
  commerceContext,
  createCommerceFixtures,
  type CommerceFixtures,
} from "./fixtures";

// Actual database, narrow routers, bcrypt and JWT signing. Email transport and
// login throttling/startup configuration are boundaries; no provider is loaded.
describe("persisted authentication lifecycle and security", () => {
  let fixture: CommerceFixtures;
  let extraUserIds: string[];
  let extraOrganizationIds: string[];
  let failAuditAction: string | null = null;
  beforeAll(() => {
    prisma.$use(async (params, next) => {
      if (
        params.model === "AuditLog" &&
        params.action === "create" &&
        failAuditAction &&
        params.args?.data?.action === failAuditAction
      ) {
        throw new Error("Synthetic audit persistence failure");
      }
      return next(params);
    });
  });
  beforeEach(async () => {
    failAuditAction = null;
    vi.clearAllMocks();
    email.verification.mockResolvedValue(undefined);
    email.reset.mockResolvedValue(undefined);
    email.invite.mockResolvedValue(undefined);
    fixture = await createCommerceFixtures(prisma);
    extraUserIds = [];
    extraOrganizationIds = [];
  });
  afterEach(async () => {
    failAuditAction = null;
    vi.restoreAllMocks();
    if (!fixture) return;
    const ownedUsers = await prisma.user.findMany({
      where: { email: { startsWith: fixture.prefix } },
      select: { id: true, organizationId: true },
    });
    const orgIds = [
      ...new Set([
        ...Object.values(fixture.tenants).map((t) => t.org.id),
        ...extraOrganizationIds,
        ...ownedUsers.flatMap((u) => (u.organizationId ? [u.organizationId] : [])),
      ]),
    ];
    await prisma.authToken.deleteMany({
      where: {
        OR: [
          { userId: { in: ownedUsers.map((u) => u.id) } },
          { email: { startsWith: fixture.prefix } },
        ],
      },
    });
    await prisma.inviteToken.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.userStoreAccess.deleteMany({ where: { userId: { in: extraUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: extraUserIds } } });
    for (const organizationId of orgIds.filter(
      (id) => !Object.values(fixture.tenants).some((t) => t.org.id === id),
    )) {
      await prisma.store.deleteMany({ where: { organizationId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    }
    await cleanupCommerceFixtures(prisma, fixture);
  });

  const anonymous = () => publicAuthRouter.createCaller(commerceContext(prisma, null));
  const admin = () =>
    usersRouter.createCaller(commerceContext(prisma, fixture.tenants.a.users.ADMIN));
  const staff = () => fixture.tenants.a.users.STAFF;
  const tokenFor = (
    purpose: "EMAIL_VERIFY" | "PASSWORD_RESET" | "REGISTRATION",
    user = staff(),
    minutes = 30,
  ) => createAuthToken({ userId: user.id, email: user.email, purpose, expiresInMinutes: minutes });
  const userRow = () => prisma.user.findUniqueOrThrow({ where: { id: staff().id } });
  const inviteFor = (targetEmail = staff().email) =>
    invitesRouter
      .createCaller(commerceContext(prisma, fixture.tenants.a.users.ADMIN))
      .create({ email: targetEmail, role: "STAFF", storeIds: [fixture.tenants.a.stores[0].id] });
  const accept = (token: string, password = fixture.password) =>
    anonymous().acceptInvite({ token, password, name: "Synthetic invitee", preferredLocale: "kg" });
  const authorize = (address: string, password: string) => {
    const provider = authOptions.providers[0] as CredentialsConfig;
    return provider.options.authorize!({ email: address, password }, { headers: {} });
  };
  const signedSession = async () => {
    const user = await authorize(staff().email, fixture.password);
    expect(user).not.toBeNull();
    const callback = authOptions.callbacks!.jwt!;
    const token = await callback({
      token: { sub: staff().id, email: staff().email },
      user,
    } as Parameters<typeof callback>[0]);
    return {
      token,
      cookie: `next-auth.session-token=${await encode({ token, secret: process.env.NEXTAUTH_SECRET! })}`,
    };
  };
  const orphan = async () => {
    const user = await prisma.user.create({
      data: {
        email: `${fixture.prefix}.onboarding@example.test`,
        name: "Synthetic onboarding",
        passwordHash: await bcrypt.hash(fixture.password, 10),
        role: "ADMIN",
      },
    });
    extraUserIds.push(user.id);
    return user;
  };
  const registrationInput = (token: string) => ({
    token,
    orgName: "Synthetic business",
    storeName: "Synthetic store",
    storeCode: "TEST",
  });

  test("verification is persisted once, rejects malformed/wrong-purpose/expired tokens, and never audits password hashes", async () => {
    await prisma.user.update({ where: { id: staff().id }, data: { emailVerifiedAt: null } });
    await expect(anonymous().verifyEmail({ token: "short" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(anonymous().verifyEmail({ token: "not-a-real-token" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const wrongPurpose = await tokenFor("PASSWORD_RESET");
    await expect(anonymous().verifyEmail({ token: wrongPurpose.raw })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const expired = await tokenFor("EMAIL_VERIFY", staff(), -1);
    await expect(anonymous().verifyEmail({ token: expired.raw })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const valid = await tokenFor("EMAIL_VERIFY");
    expect(await anonymous().verifyEmail({ token: valid.raw })).toMatchObject({
      verified: true,
      nextPath: "/login",
    });
    expect((await userRow()).emailVerifiedAt).toBeInstanceOf(Date);
    await expect(anonymous().verifyEmail({ token: valid.raw })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: staff().id, action: "EMAIL_VERIFY" },
    });
    expect(JSON.stringify(audit)).not.toContain((await userRow()).passwordHash);
  });

  test("one token is claimed by only one concurrent consumer", async () => {
    const token = await tokenFor("EMAIL_VERIFY");
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        consumeAuthToken({ purpose: "EMAIL_VERIFY", token: token.raw }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await prisma.authToken.findUniqueOrThrow({ where: { id: token.token.id } })).usedAt,
    ).toBeInstanceOf(Date);
  });

  test.each(["EMAIL_VERIFY", "PASSWORD_RESET"] as const)(
    "%s rejects a token after its user's email changes without changing either account",
    async (purpose) => {
      const token = await tokenFor(purpose);
      await prisma.user.update({
        where: { id: staff().id },
        data: { email: `${fixture.prefix}.changed@example.test`, emailVerifiedAt: null },
      });
      const other = await prisma.user.create({
        data: {
          email: staff().email,
          name: "Synthetic reassigned email",
          passwordHash: await bcrypt.hash(fixture.password, 10),
          organizationId: fixture.tenants.b.org.id,
          role: "STAFF",
        },
      });
      extraUserIds.push(other.id);
      const before = await prisma.user.findMany({
        where: { id: { in: [staff().id, other.id] } },
        orderBy: { id: "asc" },
      });
      const attempt =
        purpose === "EMAIL_VERIFY"
          ? anonymous().verifyEmail({ token: token.raw })
          : anonymous().resetPassword({ token: token.raw, password: "ChangedSynthetic123!" });
      await expect(attempt).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(
        await prisma.user.findMany({
          where: { id: { in: [staff().id, other.id] } },
          orderBy: { id: "asc" },
        }),
      ).toEqual(before);
    },
  );

  test.each(["EMAIL_VERIFY", "PASSWORD_RESET"] as const)(
    "%s cannot change a disabled account",
    async (purpose) => {
      const token = await tokenFor(purpose);
      await prisma.user.update({
        where: { id: staff().id },
        data: { isActive: false, emailVerifiedAt: null },
      });
      const before = await userRow();
      const attempt =
        purpose === "EMAIL_VERIFY"
          ? anonymous().verifyEmail({ token: token.raw })
          : anonymous().resetPassword({ token: token.raw, password: "ChangedSynthetic123!" });
      await expect(attempt).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await userRow()).toEqual(before);
    },
  );

  test("failed registration validation preserves the token for corrected retry and creates only one business", async () => {
    const user = await orphan();
    const token = await tokenFor("REGISTRATION", user);
    await expect(
      anonymous().registerBusiness({ ...registrationInput(token.raw), storeCode: "bad!" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      (await prisma.authToken.findUniqueOrThrow({ where: { id: token.token.id } })).usedAt,
    ).toBeNull();
    const result = await anonymous().registerBusiness(registrationInput(token.raw));
    extraOrganizationIds.push(result.organizationId);
    expect(await prisma.store.count({ where: { organizationId: result.organizationId } })).toBe(1);
    await expect(anonymous().registerBusiness(registrationInput(token.raw))).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  test("signup cannot replace the password of an existing incomplete account", async () => {
    const user = await orphan();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await expect(
      anonymous().signup({
        email: user.email,
        password: "AttackerSynthetic123!",
        name: "Different name",
        preferredLocale: "kg",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(before);
    expect(await prisma.authToken.count({ where: { userId: user.id } })).toBe(0);
  });

  test("password reset persists once, invalidates sibling reset links and old signed sessions, without auditing password hashes", async () => {
    const session = await signedSession();
    expect(await getAuthTokenFromCookieHeader(session.cookie)).not.toBeNull();
    const token = await tokenFor("PASSWORD_RESET");
    const sibling = await tokenFor("PASSWORD_RESET");
    await anonymous().resetPassword({ token: token.raw, password: "ChangedSynthetic123!" });
    expect(await bcrypt.compare("ChangedSynthetic123!", (await userRow()).passwordHash)).toBe(true);
    expect(await authorize(staff().email, fixture.password)).toBeNull();
    expect(await authorize(staff().email, "ChangedSynthetic123!")).not.toBeNull();
    await expect(
      anonymous().resetPassword({ token: token.raw, password: "ReuseSynthetic123!" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      anonymous().resetPassword({ token: sibling.raw, password: "SiblingSynthetic123!" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await getAuthTokenFromCookieHeader(session.cookie)).toBeNull();
    const callback = authOptions.callbacks!.jwt!;
    await expect(
      callback({ token: session.token, trigger: "update", session: {} } as Parameters<
        typeof callback
      >[0]),
    ).rejects.toThrow();
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: staff().id, action: "USER_PASSWORD_RESET" },
    });
    expect(JSON.stringify(audit)).not.toContain((await userRow()).passwordHash);
  });

  test("administrator password reset revokes an existing signed session", async () => {
    const session = await signedSession();
    await admin().resetPassword({ userId: staff().id, password: "AdminChangedSynthetic123!" });
    expect(await getAuthTokenFromCookieHeader(session.cookie)).toBeNull();
  });

  test("missing or revoked session versions cannot be renewed by read, empty update, or preference updates", async () => {
    const session = await signedSession();
    await admin().resetPassword({ userId: staff().id, password: "RevocationSynthetic123!" });
    const callback = authOptions.callbacks!.jwt!;
    for (const sessionData of [
      undefined,
      {},
      {
        sessionVersion: (await userRow()).sessionVersion,
        preferredLocale: "kg",
        themePreference: "DARK",
      },
    ]) {
      await expect(
        callback({
          token: { ...session.token },
          ...(sessionData === undefined ? {} : { trigger: "update", session: sessionData }),
        } as Parameters<typeof callback>[0]),
      ).rejects.toThrow();
    }
    const legacy = { ...session.token };
    delete legacy.sessionVersion;
    await expect(callback({ token: legacy } as Parameters<typeof callback>[0])).rejects.toThrow();
    const legacyCookie = `next-auth.session-token=${await encode({ token: legacy, secret: process.env.NEXTAUTH_SECRET! })}`;
    expect(await getAuthTokenFromCookieHeader(legacyCookie)).toBeNull();
  });

  test("disabled users lose server access and cannot sign in or refresh a session", async () => {
    const session = await signedSession();
    await admin().setActive({ userId: staff().id, isActive: false });
    expect(await getAuthTokenFromCookieHeader(session.cookie)).toBeNull();
    expect(await authorize(staff().email, fixture.password)).toBeNull();
    const callback = authOptions.callbacks!.jwt!;
    await expect(
      callback({ token: session.token, trigger: "update", session: {} } as Parameters<
        typeof callback
      >[0]),
    ).rejects.toThrow();
    await admin().setActive({ userId: staff().id, isActive: true });
    expect(await getAuthTokenFromCookieHeader(session.cookie)).toBeNull();
    expect(await authorize(staff().email, fixture.password)).not.toBeNull();
  });

  test("required email verification blocks login and existing-session protected access until verified", async () => {
    const session = await signedSession();
    await prisma.user.update({ where: { id: staff().id }, data: { emailVerifiedAt: null } });
    const login = await Promise.resolve(authorize(staff().email, fixture.password)).catch(
      () => null,
    );
    const serverToken = await getAuthTokenFromCookieHeader(session.cookie);
    const ctx = await createContext({
      req: new Request("http://localhost:3108/api/trpc/stores.list", {
        headers: { cookie: session.cookie },
      }),
    } as Parameters<typeof createContext>[0]);
    const access = await storesRouter
      .createCaller(ctx)
      .list()
      .then(
        () => true,
        () => false,
      );
    expect({
      loginAllowed: Boolean(login),
      serverTokenAllowed: Boolean(serverToken),
      protectedReadAllowed: access,
    }).toEqual({ loginAllowed: false, serverTokenAllowed: false, protectedReadAllowed: false });
    const token = await tokenFor("EMAIL_VERIFY");
    await anonymous().verifyEmail({ token: token.raw });
    expect(await authorize(staff().email, fixture.password)).not.toBeNull();
  });

  test("concurrent different password-reset links change the password once and revoke all sibling links", async () => {
    const tokens = await Promise.all(Array.from({ length: 4 }, () => tokenFor("PASSWORD_RESET")));
    const before = await userRow();
    const results = await Promise.allSettled(
      tokens.map((token, index) =>
        anonymous().resetPassword({ token: token.raw, password: `ConcurrentSynthetic${index}!` }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const updated = await userRow();
    expect(updated.sessionVersion).toBe(before.sessionVersion + 1);
    expect(
      await prisma.authToken.count({
        where: { userId: staff().id, type: "PASSWORD_RESET", usedAt: null },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { entityId: staff().id, action: "USER_PASSWORD_RESET" },
      }),
    ).toBe(1);
  });

  test("the correct password resumes incomplete signup without replacing credentials or profile", async () => {
    const user = await orphan();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const result = await anonymous().signup({
      email: user.email,
      password: fixture.password,
      name: "Changed name",
      preferredLocale: "kg",
    });
    expect(result.nextPath).toMatch(/^\/register-business\//);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(before);
  });

  test("different registration tokens for one identity cannot create two businesses concurrently", async () => {
    const user = await orphan();
    const tokens = await Promise.all([
      tokenFor("REGISTRATION", user),
      tokenFor("REGISTRATION", user),
    ]);
    const results = await Promise.allSettled(
      tokens.map((token) => anonymous().registerBusiness(registrationInput(token.raw))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved.organizationId).not.toBeNull();
    extraOrganizationIds.push(saved.organizationId!);
    expect(await prisma.store.count({ where: { organizationId: saved.organizationId! } })).toBe(1);
  });

  test("registration persists when verification delivery fails, and resend issues a usable token", async () => {
    const user = await orphan();
    const token = await tokenFor("REGISTRATION", user);
    email.verification.mockRejectedValueOnce(new Error("synthetic delivery failure"));
    const ctx = commerceContext(prisma, null);
    const warn = vi.spyOn(ctx.logger, "warn");
    const result = await publicAuthRouter
      .createCaller(ctx)
      .registerBusiness(registrationInput(token.raw));
    extraOrganizationIds.push(result.organizationId);
    expect(result).toMatchObject({ requiresEmailVerification: true, verificationEmailSent: false });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("/verify/");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).organizationId).toBe(
      result.organizationId,
    );
    expect(await anonymous().resendVerification({ email: user.email })).toEqual({ sent: true });
    const link = email.verification.mock.calls.at(-1)![0].verifyLink as string;
    const raw = new URL(link).pathname.split("/").at(-1)!;
    expect(await anonymous().verifyEmail({ token: raw })).toMatchObject({ verified: true });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt,
    ).toBeInstanceOf(Date);
  });

  test("reset requests keep unknown and disabled accounts indistinguishable and capture only active-user delivery", async () => {
    const unknown = await anonymous().requestPasswordReset({
      email: `${fixture.prefix}.unknown@example.test`,
    });
    await admin().setActive({ userId: staff().id, isActive: false });
    expect(await anonymous().requestPasswordReset({ email: staff().email })).toEqual(unknown);
    expect(email.reset).not.toHaveBeenCalled();
    await admin().setActive({ userId: staff().id, isActive: true });
    expect(await anonymous().requestPasswordReset({ email: staff().email })).toEqual(unknown);
    expect(email.reset).toHaveBeenCalledTimes(1);
    const link = email.reset.mock.calls[0][0].resetLink as string;
    expect(
      await anonymous().resetPassword({
        token: new URL(link).pathname.split("/").at(-1)!,
        password: "CapturedSynthetic123!",
      }),
    ).toEqual({ reset: true });
  });

  test.each(["EMAIL_VERIFY", "PASSWORD_RESET"] as const)(
    "%s rolls back token consumption and account changes if audit persistence fails, then retries",
    async (purpose) => {
      await prisma.user.update({ where: { id: staff().id }, data: { emailVerifiedAt: null } });
      const before = await userRow();
      const token = await tokenFor(purpose);
      const attempt = () =>
        purpose === "EMAIL_VERIFY"
          ? anonymous().verifyEmail({ token: token.raw })
          : anonymous().resetPassword({ token: token.raw, password: "AuditRetrySynthetic123!" });
      failAuditAction = purpose === "EMAIL_VERIFY" ? "EMAIL_VERIFY" : "USER_PASSWORD_RESET";
      await expect(attempt()).rejects.toThrow();
      expect(await userRow()).toEqual(before);
      expect(
        (await prisma.authToken.findUniqueOrThrow({ where: { id: token.token.id } })).usedAt,
      ).toBeNull();
      failAuditAction = null;
      await expect(attempt()).resolves.toBeDefined();
      expect(
        (await prisma.authToken.findUniqueOrThrow({ where: { id: token.token.id } })).usedAt,
      ).toBeInstanceOf(Date);
    },
  );

  test("password reset rejects malformed, expired and unbound links without changing credentials", async () => {
    const before = await userRow();
    await expect(
      anonymous().resetPassword({ token: "short", password: "InvalidSynthetic123!" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const expired = await tokenFor("PASSWORD_RESET", staff(), -1);
    await expect(
      anonymous().resetPassword({ token: expired.raw, password: "InvalidSynthetic123!" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const unbound = await createAuthToken({
      userId: null,
      email: staff().email,
      purpose: "PASSWORD_RESET",
      expiresInMinutes: 30,
    });
    await expect(
      anonymous().resetPassword({ token: unbound.raw, password: "InvalidSynthetic123!" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await userRow()).toEqual(before);
  });

  test("invite requires an existing account's password, preserves retry, and is accepted only once", async () => {
    const invite = await inviteFor();
    await expect(accept(invite.token, "WrongSynthetic123!")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(
      (await prisma.inviteToken.findUniqueOrThrow({ where: { id: invite.invite.id } })).acceptedAt,
    ).toBeNull();
    const accepted = await accept(invite.token);
    expect(accepted.user.id).toBe(staff().id);
    expect(accepted.user).not.toHaveProperty("passwordHash");
    expect(
      await prisma.userStoreAccess.count({
        where: { userId: staff().id, storeId: fixture.tenants.a.stores[0].id },
      }),
    ).toBe(1);
    await expect(accept(invite.token)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a new invitee is created once without password disclosure and can log in after captured verification", async () => {
    const address = `${fixture.prefix}.new-invitee@example.test`;
    const invite = await inviteFor(address);
    const details = await anonymous().inviteDetails({ token: invite.token });
    expect(details).not.toHaveProperty("tokenHash");
    const accepted = await accept(invite.token);
    expect(accepted.user).not.toHaveProperty("passwordHash");
    expect(accepted).toMatchObject({
      verificationEmailSent: true,
      user: {
        email: address,
        organizationId: fixture.tenants.a.org.id,
        role: "STAFF",
        emailVerifiedAt: null,
      },
    });
    await expect(Promise.resolve(authorize(address, fixture.password))).rejects.toThrow(
      "emailNotVerified",
    );
    const link = email.verification.mock.calls.at(-1)![0].verifyLink as string;
    await anonymous().verifyEmail({ token: new URL(link).pathname.split("/").at(-1)! });
    expect(await authorize(address, fixture.password)).not.toBeNull();
    await expect(accept(invite.token)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.user.count({ where: { email: address } })).toBe(1);
  });

  test("new signup persists a pending identity and registration link without creating a business twice", async () => {
    const address = `${fixture.prefix}.new-signup@example.test`;
    const created = await anonymous().signup({
      email: address,
      password: fixture.password,
      name: "Synthetic new signup",
      preferredLocale: "kg",
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: address } });
    extraUserIds.push(user.id);
    expect(user).toMatchObject({
      organizationId: null,
      emailVerifiedAt: null,
      preferredLocale: "kg",
    });
    expect(await bcrypt.compare(fixture.password, user.passwordHash)).toBe(true);
    const raw = created.nextPath!.split("/").at(-1)!;
    const registration = await anonymous().registerBusiness(registrationInput(raw));
    extraOrganizationIds.push(registration.organizationId);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isOrgOwner).toBe(true);
    await expect(anonymous().registerBusiness(registrationInput(raw))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      await prisma.store.count({ where: { organizationId: registration.organizationId } }),
    ).toBe(1);
  });

  test("concurrent acceptance of the same existing-account invite succeeds once and audits once", async () => {
    const invite = await inviteFor();
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => accept(invite.token)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: invite.invite.id, action: "INVITE_ACCEPT" },
      }),
    ).toBe(1);
  });

  test("invite rejects malformed, expired, foreign-organization and disabled existing users", async () => {
    await expect(accept("short")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const invite = await inviteFor();
    await prisma.inviteToken.update({
      where: { id: invite.invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(accept(invite.token)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(inviteFor(fixture.tenants.b.users.STAFF.email)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const activeInvite = await inviteFor();
    await admin().setActive({ userId: staff().id, isActive: false });
    await expect(accept(activeInvite.token)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
