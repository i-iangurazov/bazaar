import { isIP } from "node:net";

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import bcrypt from "bcryptjs";

import { prisma } from "@/server/db/prisma";
import { assertStartupConfigured } from "@/server/config/startupChecks";
import {
  clearLoginFailures,
  loginRateLimiter,
  registerLoginFailure,
  assertLoginAttemptAllowed,
} from "@/server/auth/rateLimiter";
import { isPlatformOwnerEmail } from "@/server/auth/platformOwner";
import { getLogger } from "@/server/logging";
import { defaultLocale, normalizeLocale, type Locale } from "@/lib/locales";
import { isEmailVerificationRequired } from "@/server/config/auth";
import { ThemePreference } from "@prisma/client";
import { getRuntimeEnv } from "@/server/config/runtime";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const DUMMY_PASSWORD_HASH = "$2a$10$4In6MZoI8L6wHWgM6i5yQOmx2s7b2Vsl6u5uzI2P7j3r4eN5mQf5K";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
const SESSION_UPDATE_AGE_SECONDS = 60 * 15;
const runtimeEnv = getRuntimeEnv();
const useSecureCookies = runtimeEnv.nodeEnv === "production";
const sessionTokenCookieName = useSecureCookies
  ? "__Secure-next-auth.session-token"
  : "next-auth.session-token";
const callbackUrlCookieName = useSecureCookies
  ? "__Secure-next-auth.callback-url"
  : "next-auth.callback-url";
const useHostCsrfCookie = useSecureCookies && runtimeEnv.nextAuthUrl.startsWith("https://");
const csrfTokenCookieName = useHostCsrfCookie ? "__Host-next-auth.csrf-token" : "next-auth.csrf-token";

const getHeader = (req: unknown, name: string) => {
  if (!req || typeof req !== "object") {
    return undefined;
  }
  const headers = (req as { headers?: Record<string, string> | Headers }).headers;
  if (!headers) {
    return undefined;
  }
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const value = (headers as Record<string, string | string[] | undefined>)[name] ??
    (headers as Record<string, string | string[] | undefined>)[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

const parseCookies = (cookieHeader?: string) => {
  if (!cookieHeader) {
    return new Map<string, string>();
  }
  return new Map(
    cookieHeader.split(";").map((pair) => {
      const [rawKey, ...rest] = pair.trim().split("=");
      const key = decodeURIComponent(rawKey);
      const value = decodeURIComponent(rest.join("="));
      return [key, value];
    }),
  );
};

const normalizeIpToken = (value?: string | null) => {
  if (!value) {
    return null;
  }
  let token = value.trim().replace(/^for=/i, "").replace(/^"|"$/g, "");
  if (!token) {
    return null;
  }
  if (token.startsWith("[") && token.includes("]")) {
    token = token.slice(1, token.indexOf("]"));
  } else if (token.includes(":") && token.indexOf(":") === token.lastIndexOf(":")) {
    const [host, port] = token.split(":");
    if (/^\d+$/.test(port ?? "")) {
      token = host;
    }
  }
  return isIP(token) ? token : null;
};

const parseForwardedFor = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((part) => normalizeIpToken(part))
    .filter((ip): ip is string => Boolean(ip));

const resolveRequestIp = (req: unknown) => {
  const cfIp = normalizeIpToken(getHeader(req, "cf-connecting-ip"));
  if (cfIp) {
    return cfIp;
  }
  const realIp = normalizeIpToken(getHeader(req, "x-real-ip"));
  if (realIp) {
    return realIp;
  }
  const forwardedIps = parseForwardedFor(getHeader(req, "x-forwarded-for"));
  if (!forwardedIps.length) {
    return "unknown";
  }
  const trustedProxyHops = getRuntimeEnv().authTrustedProxyHops;
  const index = forwardedIps.length - 1 - trustedProxyHops;
  return forwardedIps[Math.max(0, index)] ?? forwardedIps[0] ?? "unknown";
};

const getCookie = (req: unknown, name: string) => {
  const cookieHeader = getHeader(req, "cookie");
  return parseCookies(cookieHeader).get(name);
};

const resolvePreferredLocale = (value?: string | null): Locale | undefined =>
  normalizeLocale(value);

const extractUserClaims = (
  user: unknown,
): {
  role: string;
  organizationId: string;
  preferredLocale?: string;
  themePreference?: ThemePreference;
  isPlatformOwner?: boolean;
  isOrgOwner?: boolean;
} | null => {
  if (!user || typeof user !== "object") {
    return null;
  }
  const candidate = user as {
    role?: string;
    organizationId?: string;
    preferredLocale?: string;
    themePreference?: ThemePreference;
    isPlatformOwner?: boolean;
    isOrgOwner?: boolean;
  };
  const { role, organizationId, preferredLocale, themePreference, isPlatformOwner, isOrgOwner } = candidate;
  if (!role || !organizationId) {
    return null;
  }
  return { role, organizationId, preferredLocale, themePreference, isPlatformOwner, isOrgOwner };
};

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },
  jwt: {
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  pages: {
    signIn: "/login",
  },
  useSecureCookies,
  cookies: {
    sessionToken: {
      name: sessionTokenCookieName,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    callbackUrl: {
      name: callbackUrlCookieName,
      options: {
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    csrfToken: {
      name: csrfTokenCookieName,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, req) => {
        await assertStartupConfigured();
        const logger = getLogger();
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        const { email, password } = parsed.data;
        const ip = resolveRequestIp(req);
        const loginAttempt = { email, ip };
        try {
          await loginRateLimiter.consume(`${email}:${ip}`);
          await assertLoginAttemptAllowed(loginAttempt);
        } catch (error) {
          logger.warn({ email, ip, error }, "login rate limit hit");
          if (error instanceof Error && (error.message === "loginLocked" || error.message === "loginBackoff")) {
            throw error;
          }
          throw new Error("loginRateLimited");
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive) {
          await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
          await registerLoginFailure(loginAttempt);
          return null;
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          await registerLoginFailure(loginAttempt);
          return null;
        }

        if (isEmailVerificationRequired() && !user.emailVerifiedAt) {
          throw new Error("emailNotVerified");
        }

        const storeCount = user.organizationId
          ? await prisma.store.count({
              where: { organizationId: user.organizationId },
            })
          : 0;

        if (!user.organizationId || storeCount === 0) {
          throw new Error("registrationNotCompleted");
        }

        const cookieLocale = resolvePreferredLocale(getCookie(req, "NEXT_LOCALE"));
        const storedLocale = resolvePreferredLocale(user.preferredLocale);
        const preferredLocale = cookieLocale ?? storedLocale ?? defaultLocale;

        if (preferredLocale !== user.preferredLocale) {
          await prisma.user.update({
            where: { id: user.id },
            data: { preferredLocale },
          });
        }

        logger.info({ userId: user.id, email }, "user authenticated");
        await clearLoginFailures(loginAttempt);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organizationId: user.organizationId,
          preferredLocale,
          themePreference: user.themePreference,
          isPlatformOwner: isPlatformOwnerEmail(user.email),
          isOrgOwner: Boolean(user.isOrgOwner),
        };
      },
    }),
  ],
  callbacks: {
    redirect: async ({ url, baseUrl }) => {
      const baseOrigin = new URL(baseUrl).origin;
      if (url.startsWith("/")) {
        return `${baseUrl}${url}`;
      }
      try {
        const target = new URL(url);
        if (target.origin === baseOrigin) {
          return url;
        }
      } catch {
        return baseUrl;
      }
      return baseUrl;
    },
    jwt: async ({ token, user, trigger, session }) => {
      const claims = extractUserClaims(user);
      if (claims) {
        token.role = claims.role;
        token.organizationId = claims.organizationId;
        token.preferredLocale = claims.preferredLocale ?? defaultLocale;
        token.themePreference = claims.themePreference ?? ThemePreference.LIGHT;
        token.isPlatformOwner = claims.isPlatformOwner ?? false;
        token.isOrgOwner = claims.isOrgOwner ?? false;
      }
      if (trigger === "update" && session && typeof session === "object") {
        const updatePayload = session as {
          preferredLocale?: string;
          themePreference?: string;
          isPlatformOwner?: boolean;
          isOrgOwner?: boolean;
        };
        if (updatePayload.preferredLocale) {
          token.preferredLocale = resolvePreferredLocale(updatePayload.preferredLocale) ?? defaultLocale;
        }
        if (updatePayload.themePreference) {
          token.themePreference =
            updatePayload.themePreference === ThemePreference.DARK
              ? ThemePreference.DARK
              : ThemePreference.LIGHT;
        }
        if (typeof updatePayload.isPlatformOwner === "boolean") {
          token.isPlatformOwner = updatePayload.isPlatformOwner;
        }
        if (typeof updatePayload.isOrgOwner === "boolean") {
          token.isOrgOwner = updatePayload.isOrgOwner;
        }
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = token.role as string;
        session.user.organizationId = token.organizationId as string;
        session.user.preferredLocale = (token.preferredLocale as string) ?? defaultLocale;
        session.user.themePreference = (token.themePreference as string) ?? ThemePreference.LIGHT;
        session.user.isPlatformOwner = Boolean(token.isPlatformOwner);
        session.user.isOrgOwner = Boolean(token.isOrgOwner);
      }
      return session;
    },
  },
};
