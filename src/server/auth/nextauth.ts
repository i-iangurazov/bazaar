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
): { role: string; organizationId: string; preferredLocale?: string; isPlatformOwner?: boolean } | null => {
  if (!user || typeof user !== "object") {
    return null;
  }
  const candidate = user as {
    role?: string;
    organizationId?: string;
    preferredLocale?: string;
    isPlatformOwner?: boolean;
  };
  const { role, organizationId, preferredLocale, isPlatformOwner } = candidate;
  if (!role || !organizationId) {
    return null;
  }
  return { role, organizationId, preferredLocale, isPlatformOwner };
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
        assertStartupConfigured();
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
        if (!user.organizationId) {
          throw new Error("registrationNotCompleted");
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          return null;
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
          isPlatformOwner: isPlatformOwnerEmail(user.email),
        };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      const claims = extractUserClaims(user);
      if (claims) {
        token.role = claims.role;
        token.organizationId = claims.organizationId;
        token.preferredLocale = claims.preferredLocale ?? defaultLocale;
        token.isPlatformOwner = claims.isPlatformOwner ?? false;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = token.role as string;
        session.user.organizationId = token.organizationId as string;
        session.user.preferredLocale = (token.preferredLocale as string) ?? defaultLocale;
        session.user.isPlatformOwner = Boolean(token.isPlatformOwner);
      }
      return session;
    },
  },
};
