import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { Role, type User } from "@prisma/client";
import type { Session } from "next-auth";
import type { CredentialsConfig } from "next-auth/providers/credentials";
import { decode, encode } from "next-auth/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authOptions } from "@/server/auth/nextauth";
import { prisma } from "@/server/db/prisma";
import { canAccessAppRoute, getRoleHomePath } from "@/lib/roleAccess";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const password = "Synthetic-entry-test123!";
const authorize = (user: User, value = password) =>
  (authOptions.providers[0] as CredentialsConfig).options.authorize!(
    { email: user.email, password: value },
    { headers: { "x-real-ip": "198.51.100.211" } },
  );
const jwt = authOptions.callbacks!.jwt!;
const sessionCallback = authOptions.callbacks!.session!;

describeDb("persisted credentials and login destinations", () => {
  let users: Record<Role, User>;
  beforeEach(async () => {
    await resetDatabase();
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

  it("rejects a previously signed session after its database version is revoked", async () => {
    const { token } = await signedSession(users.STAFF);
    await prisma.user.update({ where: { id: users.STAFF.id }, data: { sessionVersion: { increment: 1 } } });
    await expect(jwt({ token } as Parameters<typeof jwt>[0])).rejects.toThrow("sessionUserUnavailable");
  });
});
