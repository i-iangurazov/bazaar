import type { Session } from "next-auth";
import { decode, encode, type JWT } from "next-auth/jwt";
import { ThemePreference } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ findUser: vi.fn() }));
vi.mock("@/server/db/prisma", () => ({ prisma: { user: { findUnique: db.findUser } } }));
vi.mock("@/server/config/startupChecks", () => ({ assertStartupConfigured: vi.fn() }));
// This suite isolates claim provenance. Required-verification authorization is
// exercised against actual database users in auth-lifecycle.test.ts.
vi.mock("@/server/config/auth", () => ({ isEmailVerificationRequired: () => false }));
vi.mock("@/server/config/runtime", () => ({
  getRuntimeEnv: () => ({
    nodeEnv: "test",
    nextAuthUrl: "http://localhost:3108",
    authTrustedProxyHops: 0,
  }),
}));
vi.mock("@/server/auth/rateLimiter", () => ({
  clearLoginFailures: vi.fn(),
  loginRateLimiter: { consume: vi.fn() },
  registerLoginFailure: vi.fn(),
  assertLoginAttemptAllowed: vi.fn(),
}));

import { authOptions } from "@/server/auth/nextauth";
import { getAuthTokenFromCookieHeader } from "@/server/auth/token";
import { canAccessAppRoute } from "@/lib/roleAccess";

const secret = "synthetic-session-claims-test-secret";
const baseToken = (): JWT => ({
  sub: "synthetic-user",
  sessionVersion: 0,
  email: "synthetic@example.invalid",
  role: "STAFF",
  organizationId: "synthetic-org",
  isOrgOwner: false,
  isPlatformOwner: false,
  emailVerified: false,
  preferredLocale: "ru",
  themePreference: ThemePreference.LIGHT,
});
const databaseUser = () => ({
  id: "synthetic-user",
  sessionVersion: 0,
  email: "synthetic@example.invalid",
  name: "Synthetic user",
  role: "STAFF",
  organizationId: "synthetic-org",
  isOrgOwner: false,
  emailVerifiedAt: null as Date | null,
  isActive: true,
  preferredLocale: "ru",
  themePreference: ThemePreference.LIGHT,
});
const jwtCallback = authOptions.callbacks!.jwt!;
const sessionCallback = authOptions.callbacks!.session!;
const update = (token: JWT, session: unknown) =>
  jwtCallback({
    token,
    trigger: "update",
    session,
  } as Parameters<typeof jwtCallback>[0]);
const sessionFor = (token: JWT) =>
  sessionCallback({
    session: {
      user: { email: token.email },
      expires: new Date(Date.now() + 3600000).toISOString(),
    },
    token,
  } as Parameters<typeof sessionCallback>[0]) as Promise<Session>;

describe("NextAuth session-update security claims", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXTAUTH_SECRET", secret);
    vi.stubEnv("PLATFORM_OWNER_EMAILS", "owner@example.invalid");
    db.findUser.mockResolvedValue(databaseUser());
  });
  afterEach(() => vi.unstubAllEnvs());

  it("does not sign client-supplied ownership/verification claims while preserving preferences", async () => {
    // NextAuth's normal update path passes body.data as session to this callback,
    // then signs its returned token and invokes the session callback.
    const token = await update(baseToken(), {
      isPlatformOwner: true,
      isOrgOwner: true,
      emailVerified: true,
      role: "ADMIN",
      organizationId: "foreign-org",
      sub: "foreign-user",
      preferredLocale: "kg",
      themePreference: "DARK",
    });
    const signed = await encode({ token, secret });
    const decoded = (await decode({ token: signed, secret }))!;
    const session = await sessionFor(decoded);
    expect(session.user.isPlatformOwner).toBe(false);
    expect(session.user).toMatchObject({
      id: "synthetic-user",
      role: "STAFF",
      organizationId: "synthetic-org",
      isPlatformOwner: false,
      isOrgOwner: false,
      emailVerified: false,
      preferredLocale: "kg",
      themePreference: "DARK",
    });
    expect(canAccessAppRoute("/platform", decoded)).toBe(false);
  });

  it("repairs stale security claims from the database on session update", async () => {
    const token = await update(
      {
        ...baseToken(),
        role: "ADMIN",
        isOrgOwner: true,
        isPlatformOwner: true,
        emailVerified: true,
      },
      {},
    );
    expect(token).toMatchObject({
      role: "STAFF",
      isOrgOwner: false,
      isPlatformOwner: false,
      emailVerified: false,
    });
  });

  it("keeps legitimate database ownership and verification even if a client sends false", async () => {
    db.findUser.mockResolvedValue({
      ...databaseUser(),
      email: "owner@example.invalid",
      isOrgOwner: true,
      emailVerifiedAt: new Date(),
    });
    const token = await update(baseToken(), {
      isPlatformOwner: false,
      isOrgOwner: false,
      emailVerified: false,
    });
    expect(token).toMatchObject({
      email: "owner@example.invalid",
      isPlatformOwner: true,
      isOrgOwner: true,
      emailVerified: true,
    });
  });

  it("revalidates a signed cookie's security flags, including email verification, before server use", async () => {
    const signed = await encode({
      secret,
      token: {
        ...baseToken(),
        role: "ADMIN",
        organizationId: "foreign-org",
        isOrgOwner: true,
        isPlatformOwner: true,
        emailVerified: true,
      },
    });
    const authoritative = await getAuthTokenFromCookieHeader(`next-auth.session-token=${signed}`);
    expect(authoritative).toMatchObject({
      role: "STAFF",
      organizationId: "synthetic-org",
      isOrgOwner: false,
      isPlatformOwner: false,
    });
    expect(canAccessAppRoute("/platform", authoritative!)).toBe(false);
    expect(authoritative?.emailVerified).toBe(false);
  });

  it("rejects session updates for disabled or missing database users", async () => {
    db.findUser
      .mockResolvedValueOnce({ ...databaseUser(), isActive: false })
      .mockResolvedValueOnce(null);
    await expect(update(baseToken(), { preferredLocale: "kg" })).rejects.toThrow();
    await expect(update(baseToken(), {})).rejects.toThrow();
  });

  it("ignores malformed preference values and keeps supported legacy locale normalization", async () => {
    const malformed = await update(baseToken(), {
      preferredLocale: { invalid: true },
      themePreference: ["DARK"],
    });
    expect(malformed).toMatchObject({ preferredLocale: "ru", themePreference: "LIGHT" });
    expect(
      await update(baseToken(), { preferredLocale: "ky", themePreference: "DARK" }),
    ).toMatchObject({ preferredLocale: "kg", themePreference: "DARK" });
  });

  it("treats a missing verification claim as unverified in a legacy client session", async () => {
    const token = baseToken();
    delete token.emailVerified;
    expect((await sessionFor(token)).user.emailVerified).toBe(false);
  });
});
