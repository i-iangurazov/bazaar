import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

import {
  defaultLocale,
  getLocaleFromAcceptLanguage,
  normalizeLocale,
  type Locale,
} from "./lib/locales";
import { canAccessAppRoute, getRoleHomePath } from "./lib/roleAccess";
import { legalDraftPreviewAllowed } from "./lib/legalPreview";
import { legalPublicationState } from "./lib/legalPublication";
import {
  isMarketingLandingPath,
  marketingHomePath,
  marketingLocaleFromPath,
  marketingLocaleHeader,
} from "./lib/marketingSeo";
import {
  acquisitionCookieName,
  acquisitionFromSearch,
  acquisitionMaxAge,
  parseAcquisition,
} from "./lib/acquisition";

const localeCookieOptions = {
  path: "/",
  maxAge: 31536000,
  sameSite: "lax",
  httpOnly: true,
} as const;

export const protectedPrefixes = [
  "/baam",
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
  "/help/compliance",
  "/settings",
  "/stores",
  "/suppliers",
];

export const isProtectedPath = (pathname: string) =>
  protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

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
  // A page-level notFound can be streamed with HTTP 200 by the App Router.
  // Reject unpublished legal drafts before rendering, including locale aliases.
  if (
    /^\/(?:ru\/|kg\/|ky\/|en\/)?legal(?:\/|$)/.test(pathname) &&
    !legalPublicationState(process.env).published &&
    !legalDraftPreviewAllowed(process.env, request.headers.get("host"))
  ) {
    return new NextResponse(null, {
      status: 404,
      headers: {
        "x-request-id": requestId,
        "x-robots-tag": "noindex, nofollow, noarchive",
        "cache-control": "private, no-store",
      },
    });
  }
  const segments = pathname.split("/");
  const maybeLocale = segments[1];
  const pathLocale = normalizeLocale(maybeLocale);
  const marketingLocale = marketingLocaleFromPath(pathname);
  if (marketingLocale && maybeLocale === "ky") {
    const nextUrl = request.nextUrl.clone();
    nextUrl.pathname = marketingHomePath(marketingLocale);
    const redirectResponse = NextResponse.redirect(nextUrl);
    redirectResponse.headers.set("x-request-id", requestId);
    redirectResponse.cookies.set("NEXT_LOCALE", marketingLocale, localeCookieOptions);
    return redirectResponse;
  }
  if (pathLocale && !marketingLocale) {
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
      // Match the cookie policy in authOptions even for local production builds.
      secureCookie: process.env.NODE_ENV === "production",
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

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.delete(marketingLocaleHeader);
  if (marketingLocale) forwardedHeaders.set(marketingLocaleHeader, marketingLocale);
  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
  // First tagged visit wins for 30 days. Never track private app/catalog pages,
  // prefetches or privacy opt-outs; capture happens before any signup navigation.
  if (
    (isMarketingLandingPath(pathname) || pathname === "/signup") &&
    !request.headers.has("next-router-prefetch") &&
    request.headers.get("purpose") !== "prefetch"
  ) {
    if (request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1") {
      response.cookies.delete(acquisitionCookieName);
    } else if (!parseAcquisition(request.cookies.get(acquisitionCookieName)?.value)) {
      const acquisition = acquisitionFromSearch(request.nextUrl.searchParams);
      if (acquisition)
        response.cookies.set(acquisitionCookieName, JSON.stringify(acquisition), {
          path: "/",
          maxAge: acquisitionMaxAge,
          httpOnly: true,
          sameSite: "lax",
          secure: request.nextUrl.protocol === "https:",
        });
    }
  }
  const resolvedLocale = marketingLocale ?? resolveLocale(request);
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
