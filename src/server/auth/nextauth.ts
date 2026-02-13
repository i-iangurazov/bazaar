import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import bcrypt from "bcryptjs";

import { prisma } from "@/server/db/prisma";
import { assertStartupConfigured } from "@/server/config/startupChecks";
import { loginRateLimiter } from "@/server/auth/rateLimiter";
import { isPlatformOwnerEmail } from "@/server/auth/platformOwner";
import { getLogger } from "@/server/logging";
import { defaultLocale, normalizeLocale, type Locale } from "@/lib/locales";
import { isEmailVerificationRequired } from "@/server/config/auth";
import { ThemePreference } from "@prisma/client";
import { createAuthToken } from "@/server/services/authTokens";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

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
  },
  pages: {
    signIn: "/login",
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
        const forwarded = getHeader(req, "x-forwarded-for");
        const ip = forwarded ? forwarded.split(",")[0]?.trim() : "unknown";
        try {
          await loginRateLimiter.consume(`${email}:${ip}`);
        } catch (error) {
          logger.warn({ email, ip, error }, "login rate limit hit");
          throw new Error("loginRateLimited");
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive) {
          return null;
        }
        if (isEmailVerificationRequired() && !user.emailVerifiedAt) {
          throw new Error("emailNotVerified");
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          return null;
        }

        const storeCount = user.organizationId
          ? await prisma.store.count({
              where: { organizationId: user.organizationId },
            })
          : 0;

        if (!user.organizationId || storeCount === 0) {
          const registration = await createAuthToken({
            userId: user.id,
            email: user.email,
            purpose: "REGISTRATION",
            expiresInMinutes: 60,
            organizationId: user.organizationId,
            actorId: user.id,
          });
          throw new Error(`registrationNotCompleted:${registration.raw}`);
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
