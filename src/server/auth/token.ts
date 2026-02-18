import { cookies, headers } from "next/headers";
import { ThemePreference } from "@prisma/client";
import { decode, type JWT } from "next-auth/jwt";

import { isPlatformOwnerEmail } from "@/server/auth/platformOwner";
import { prisma } from "@/server/db/prisma";

const sessionCookieNames = [
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
];

const parseCookieHeader = (cookieHeader?: string | null) => {
  if (!cookieHeader) {
    return new Map<string, string>();
  }
  return new Map(
    cookieHeader
      .split(";")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [rawKey, ...rest] = pair.split("=");
        const key = decodeURIComponent(rawKey);
        const value = decodeURIComponent(rest.join("="));
        return [key, value];
      }),
  );
};

const getSessionTokenFromCookieHeader = (cookieHeader?: string | null) => {
  const map = parseCookieHeader(cookieHeader);
  for (const name of sessionCookieNames) {
    const value = map.get(name);
    if (value) {
      return value;
    }
  }
  return null;
};

const getSessionTokenFromCookieStore = (cookieStore: ReturnType<typeof cookies>) => {
  for (const name of sessionCookieNames) {
    const value = cookieStore.get(name)?.value;
    if (value) {
      return value;
    }
  }
  return null;
};

const decodeSessionToken = async (token: string) => {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return null;
  }
  try {
    return await decode({
      token,
      secret,
    });
  } catch {
    return null;
  }
};

const revalidateUserClaims = async (token: JWT | null) => {
  if (!token?.sub) {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: token.sub },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      organizationId: true,
      isOrgOwner: true,
      isActive: true,
      preferredLocale: true,
      themePreference: true,
    },
  });
  if (!user || !user.isActive || !user.organizationId) {
    return null;
  }
  return {
    ...token,
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId,
    isOrgOwner: user.isOrgOwner,
    isPlatformOwner: isPlatformOwnerEmail(user.email),
    preferredLocale: user.preferredLocale,
    themePreference: user.themePreference ?? ThemePreference.LIGHT,
  } as JWT;
};

export const getAuthTokenFromCookieHeader = async (cookieHeader?: string | null) => {
  const sessionToken = getSessionTokenFromCookieHeader(cookieHeader);
  if (!sessionToken) {
    return null;
  }
  const token = await decodeSessionToken(sessionToken);
  return revalidateUserClaims(token);
};

export const getServerAuthToken = async () => {
  const cookieStore = cookies();
  const headerStore = headers();
  const sessionToken =
    getSessionTokenFromCookieStore(cookieStore) ??
    getSessionTokenFromCookieHeader(headerStore.get("cookie"));
  if (!sessionToken) {
    return null;
  }
  const token = await decodeSessionToken(sessionToken);
  return revalidateUserClaims(token);
};
