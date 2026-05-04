import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

import {
  defaultLocale,
  getLocaleFromAcceptLanguage,
  normalizeLocale,
  type Locale,
} from "./src/lib/locales";
import { canAccessAppRoute, getRoleHomePath } from "./src/lib/roleAccess";

const localeCookieOptions = {
  path: "/",
  maxAge: 31536000,
  sameSite: "lax",
  httpOnly: true,
} as const;

export const protectedPrefixes = [
  "/admin",
  "/billing",
  "/cash",
  "/customers",
  "/dashboard",
  "/dev",
  "/finance",
  "/inventory",
  "/operations",
  "/orders",
  "/platform",
  "/pos",
  "/purchase-orders",
  "/products",
  "/reports",
  "/sales",
  "/onboarding",
  "/help",
  "/settings",
  "/stores",
  "/suppliers",
];

export const isProtectedPath = (pathname: string) =>
  protectedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

const resolveLocale = (request: NextRequest): Locale => {
  const cookieLocale = normalizeLocale(request.cookies.get("NEXT_LOCALE")?.value);
  if (cookieLocale) {
    return cookieLocale;
  }
  const headerLocale = getLocaleFromAcceptLanguage(request.headers.get("accept-language"));
  return headerLocale ?? defaultLocale;
};

export const middleware = async (request: NextRequest) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { pathname } = request.nextUrl;
  const segments = pathname.split("/");
  const maybeLocale = segments[1];
  const pathLocale = normalizeLocale(maybeLocale);
  if (pathLocale) {
    const rest = segments.slice(2).join("/");
    const nextUrl = request.nextUrl.clone();
    nextUrl.pathname = rest ? `/${rest}` : "/";
    const redirectResponse = NextResponse.redirect(nextUrl);
    redirectResponse.headers.set("x-request-id", requestId);
    redirectResponse.cookies.set("NEXT_LOCALE", pathLocale, localeCookieOptions);
    return redirectResponse;
  }

  if (isProtectedPath(pathname)) {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });
    if (!token) {
      const locale = resolveLocale(request);
      const nextPath = pathname === "/" ? "/" : pathname;
      const nextParam = request.nextUrl.search ? `${nextPath}${request.nextUrl.search}` : nextPath;
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", nextParam);
      const redirectResponse = NextResponse.redirect(loginUrl);
      redirectResponse.headers.set("x-request-id", requestId);
      redirectResponse.cookies.set("NEXT_LOCALE", locale, localeCookieOptions);
      return redirectResponse;
    }
    const access = {
      role: token.role,
      isPlatformOwner: Boolean(token.isPlatformOwner),
      isOrgOwner: Boolean(token.isOrgOwner),
    };
    if (!canAccessAppRoute(pathname, access)) {
      const nextPath = pathname === "/" ? "/" : pathname;
      const nextParam = request.nextUrl.search ? `${nextPath}${request.nextUrl.search}` : nextPath;
      const deniedUrl = new URL(getRoleHomePath(access), request.url);
      deniedUrl.searchParams.set("from", nextParam);
      const redirectResponse = NextResponse.redirect(deniedUrl);
      redirectResponse.headers.set("x-request-id", requestId);
      return redirectResponse;
    }
  }

  const response = NextResponse.next();
  const resolvedLocale = resolveLocale(request);
  const existingLocale = request.cookies.get("NEXT_LOCALE")?.value;
  if (existingLocale !== resolvedLocale) {
    response.cookies.set("NEXT_LOCALE", resolvedLocale, localeCookieOptions);
  }
  response.headers.set("x-request-id", requestId);
  return response;
};

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
