import { ThemePreference } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  headers: new Headers(),
  findUser: vi.fn(),
}));

vi.mock("next/headers", () => ({
  // Promise-only request APIs deliberately lack the temporary synchronous API
  // that Next 15 provides for migration. Every consumer must await the request.
  cookies: async () => ({
    get: (name: string) => {
      const value = request.cookies.get(name);
      return value === undefined ? undefined : { value };
    },
  }),
  headers: async () => request.headers,
}));
vi.mock("next-intl/server", () => ({ getRequestConfig: (config: unknown) => config }));
vi.mock("@/server/db/prisma", () => ({ prisma: { user: { findUnique: request.findUser } } }));
vi.mock("@/server/config/auth", () => ({ isEmailVerificationRequired: () => false }));

import getRequestConfig from "@/i18n";
import { getServerAuthToken } from "@/server/auth/token";

const secret = "synthetic-next15-request-regression-secret";
const storedUser = () => ({
  id: "synthetic-user",
  email: "staff@example.invalid",
  name: "Synthetic Staff",
  role: "STAFF",
  organizationId: "synthetic-org",
  isOrgOwner: false,
  emailVerifiedAt: null,
  sessionVersion: 3,
  isActive: true,
  preferredLocale: "kg",
  themePreference: ThemePreference.LIGHT,
});
const signedCookie = (sessionVersion = 3) => encode({
  secret,
  token: {
    sub: "synthetic-user",
    sessionVersion,
    role: "ADMIN",
    organizationId: "foreign-org",
    isOrgOwner: true,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXTAUTH_SECRET", secret);
  request.cookies.clear();
  request.headers = new Headers();
  request.findUser.mockResolvedValue(storedUser());
});
afterEach(() => vi.unstubAllEnvs());

describe("Next 15 request-local locale resolution", () => {
  it.each(["ru", "kg", "en"])("preserves the %s cookie above the request language", async (locale) => {
    request.cookies.set("NEXT_LOCALE", locale);
    request.headers.set("accept-language", locale === "en" ? "ru" : "en");
    const config = await getRequestConfig({ requestLocale: Promise.resolve(undefined) });
    expect(config.locale).toBe(locale);
    expect(config.timeZone).toBe("Asia/Bishkek");
    expect(config.messages).toHaveProperty("common");
  });

  it("normalizes the legacy Kyrgyz cookie and falls back through the language header", async () => {
    request.cookies.set("NEXT_LOCALE", "ky");
    expect((await getRequestConfig({ requestLocale: Promise.resolve(undefined) })).locale).toBe("kg");
    request.cookies.set("NEXT_LOCALE", "unsupported");
    request.headers.set("accept-language", "en-US,en;q=0.9");
    expect((await getRequestConfig({ requestLocale: Promise.resolve(undefined) })).locale).toBe("en");
    request.headers.delete("accept-language");
    expect((await getRequestConfig({ requestLocale: Promise.resolve(undefined) })).locale).toBe("ru");
  });
});

describe("Next 15 session request APIs", () => {
  it("awaits the secure session cookie and revalidates organization and role from the database", async () => {
    request.cookies.set("__Secure-next-auth.session-token", await signedCookie());
    const token = await getServerAuthToken();
    expect(token).toMatchObject({
      sub: "synthetic-user",
      role: "STAFF",
      organizationId: "synthetic-org",
      isOrgOwner: false,
      sessionVersion: 3,
    });
    expect(request.findUser).toHaveBeenCalledOnce();
  });

  it("retains the cookie header fallback without accepting its stale security claims", async () => {
    request.headers.set("cookie", `next-auth.session-token=${await signedCookie()}`);
    expect(await getServerAuthToken()).toMatchObject({ role: "STAFF", organizationId: "synthetic-org" });
  });

  it("does not share request cookies or a cached user across successive sessions", async () => {
    request.cookies.set("next-auth.session-token", await signedCookie());
    expect(await getServerAuthToken()).toMatchObject({ sub: "synthetic-user" });
    request.cookies.clear();
    expect(await getServerAuthToken()).toBeNull();
    expect(request.findUser).toHaveBeenCalledOnce();
  });

  it.each(["revoked", "disabled", "removed"])("rejects a %s user after reading an asynchronous cookie", async (state) => {
    request.cookies.set("next-auth.session-token", await signedCookie(state === "revoked" ? 2 : 3));
    request.findUser.mockResolvedValue(state === "removed" ? null : { ...storedUser(), isActive: state !== "disabled" });
    expect(await getServerAuthToken()).toBeNull();
  });

  it("rejects a corrupted token without a database lookup", async () => {
    request.cookies.set("next-auth.session-token", "not-a-signed-session");
    expect(await getServerAuthToken()).toBeNull();
    expect(request.findUser).not.toHaveBeenCalled();
  });
});
