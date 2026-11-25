import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { Role, type User } from "@prisma/client";
import type { Session } from "next-auth";
import type { CredentialsConfig } from "next-auth/providers/credentials";
import { decode, encode } from "next-auth/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authOptions } from "@/server/auth/nextauth";
import { clearLoginFailures, registerLoginFailure, unknownPhoneLoginIdentity } from "@/server/auth/rateLimiter";
import { prisma } from "@/server/db/prisma";
import { canAccessAppRoute, getRoleHomePath } from "@/lib/roleAccess";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const password = "Synthetic-entry-test123!";
const requestIp = "198.51.100.211";
const authorizeIdentifier = (identifier: { email: string } | { phone: string }, value = password) =>
  (authOptions.providers[0] as CredentialsConfig).options.authorize!(
    { ...identifier, password: value },
    { headers: { "x-real-ip": requestIp } },
  );
const authorize = (user: User, value = password) =>
  authorizeIdentifier({ email: user.email }, value);
const jwt = authOptions.callbacks!.jwt!;
const sessionCallback = authOptions.callbacks!.session!;

describeDb("persisted credentials and login destinations", () => {
  let users: Record<Role, User>;
  beforeEach(async () => {
    await resetDatabase();
    await clearLoginFailures({ email: unknownPhoneLoginIdentity("+996555123456"), ip: requestIp });
    const seed = await seedBase({ plan: "BUSINESS" });
    const hash = await bcrypt.hash(password, 10);
    const prefix = `espresso-auth-${randomUUID()}`;
    const updated = await Promise.all(
      [seed.adminUser, seed.managerUser, seed.staffUser, seed.cashierUser].map((user) =>
        prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: hash, email: `${prefix}.${user.role.toLowerCase()}@example.invalid` },
        }),
      ),
    );
    users = Object.fromEntries(updated.map((user) => [user.role, user])) as Record<Role, User>;
  });
  afterEach(() => vi.unstubAllEnvs());

  const signedSession = async (user: User) => {
    const authorized = await authorize(user);
    expect(authorized).not.toBeNull();
    const token = await jwt({
      token: { sub: user.id, email: user.email }, user: authorized,
    } as Parameters<typeof jwt>[0]);
    const secret = process.env.NEXTAUTH_SECRET!;
    const verified = (await decode({ token: await encode({ token, secret }), secret }))!;
    const session = await sessionCallback({
      token: verified,
      session: { user: { email: user.email }, expires: new Date(Date.now() + 3600000).toISOString() },
    } as Parameters<typeof sessionCallback>[0]) as Session;
    return { token: verified, session };
  };

  it.each([
    [Role.ADMIN, "/dashboard"], [Role.MANAGER, "/dashboard"],
    [Role.STAFF, "/pos"], [Role.CASHIER, "/pos"],
  ])("issues database-backed claims and an accessible default workspace for %s", async (role, destination) => {
    const { session } = await signedSession(users[role as Role]);
    expect(session.user.role).toBe(role);
    expect(getRoleHomePath(session.user)).toBe(destination);
    expect(canAccessAppRoute(destination, session.user)).toBe(true);
  });

  it("keeps the platform workspace available only to the configured owner", async () => {
    vi.stubEnv("PLATFORM_OWNER_EMAILS", users.ADMIN.email);
    const owner = await signedSession(users.ADMIN);
    const manager = await signedSession(users.MANAGER);
    expect(owner.session.user.isPlatformOwner).toBe(true);
    expect(canAccessAppRoute("/platform", owner.session.user)).toBe(true);
    expect(manager.session.user.isPlatformOwner).toBe(false);
    expect(canAccessAppRoute("/platform", manager.session.user)).toBe(false);
  });

  it("does not authorize a disabled account", async () => {
    await prisma.user.update({ where: { id: users.STAFF.id }, data: { isActive: false } });
    expect(await authorize(users.STAFF)).toBeNull();
  });

  it("preserves the required email verification gate", async () => {
    await prisma.user.update({ where: { id: users.STAFF.id }, data: { emailVerifiedAt: null } });
    await expect(authorize(users.STAFF)).rejects.toThrow("emailNotVerified");
  });

  it("does not authorize a wrong password", async () => {
    expect(await authorize(users.CASHIER, "Synthetic-wrong-password!")).toBeNull();
  });

  it("makes a private phone alias available after password confirmation and keeps email login and recovery", async () => {
    const user = users.STAFF;
    const caller = createTestCaller({ ...user, organizationId: user.organizationId! });
    await prisma.user.update({ where: { id: user.id }, data: { phone: "+996 555 123 456" } });
    expect(await authorizeIdentifier({ phone: "0555 123 456" })).toBeNull();
    await expect(caller.userSettings.updateMyLoginPhone({ phone: "0555 123 456", password: "wrong" }))
      .rejects.toMatchObject({ message: "accountPasswordIncorrect" });
    await expect(caller.userSettings.updateMyLoginPhone({ phone: "0555 123 456", password }))
      .resolves.toEqual({ userId: user.id, phone: "+996555123456" });
    await expect(caller.userSettings.getMyLoginPhone()).resolves.toEqual({ userId: user.id, phone: "+996555123456" });
    const emailAccount = await authorize(user);
    expect(emailAccount).not.toBeNull();
    await expect(authorizeIdentifier({ phone: "+996 (555) 123-456" })).resolves.toEqual(emailAccount);
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
    await expect(authorizeIdentifier({ phone: "555123456" })).rejects.toThrow("emailNotVerified");
  });

  it("serializes normalized alias claims, rejects wrong-password removal and frees a disabled alias", async () => {
    const user = users.STAFF;
    const otherUser = users.CASHIER;
    const first = createTestCaller({ ...user, organizationId: user.organizationId! });
    const second = createTestCaller({ ...otherUser, organizationId: otherUser.organizationId! });
    const results = await Promise.allSettled([
      first.userSettings.updateMyLoginPhone({ phone: "+996 555 123 456", password }),
      second.userSettings.updateMyLoginPhone({ phone: "0555123456", password }),
    ]);
    const winner = results[0]?.status === "fulfilled" ? first : second;
    const loser = results[0]?.status === "fulfilled" ? second : first;
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "CONFLICT", message: "loginPhoneInUse" } });
    await expect(loser.userSettings.getMyLoginPhone()).resolves.toMatchObject({ phone: null });
    await expect(winner.userSettings.updateMyLoginPhone({ phone: null, password: "wrong" }))
      .rejects.toMatchObject({ message: "accountPasswordIncorrect" });
    await expect(winner.userSettings.updateMyLoginPhone({ phone: null, password })).resolves.toMatchObject({ phone: null });
    expect(await authorizeIdentifier({ phone: "555123456" })).toBeNull();
    await expect(loser.userSettings.updateMyLoginPhone({ phone: "555123456", password }))
      .resolves.toMatchObject({ phone: "+996555123456" });
  });

  it("shares the same lockout across email and phone", async () => {
    const user = users.CASHIER;
    const phone = "+996555123456";
    await prisma.userLoginPhone.create({ data: { userId: user.id, phone } });
    const attempt = { email: user.email, ip: requestIp };
    try {
      expect(await authorizeIdentifier({ phone }, "Synthetic-wrong-password!")).toBeNull();
      for (let attemptIndex = 0; attemptIndex < 9; attemptIndex++) await registerLoginFailure(attempt);
      await expect(authorize(user)).rejects.toThrow("loginLocked");
      await expect(authorizeIdentifier({ phone: "0555 123 456" })).rejects.toThrow("loginLocked");
    } finally {
      await clearLoginFailures(attempt);
    }
  });

  it("rejects a previously signed session after its database version is revoked", async () => {
    const { token } = await signedSession(users.STAFF);
    await prisma.user.update({ where: { id: users.STAFF.id }, data: { sessionVersion: { increment: 1 } } });
    await expect(jwt({ token } as Parameters<typeof jwt>[0])).rejects.toThrow("sessionUserUnavailable");
  });
});
