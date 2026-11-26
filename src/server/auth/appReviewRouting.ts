import type { JWT } from "next-auth/jwt";

const productionOrigin = "https://www.bazaar.kg";
const previewDashboard = "https://bazaar-ios-preview-20261111.vercel.app/dashboard";
const reviewUserAgent = /(?:^|\s)BazaarNativeIOS\/\d+\.\d+\.\d+\s+\(production\)\s+BazaarAppReview\/1(?:\s|$)/;

export function appReviewDestination(
  token: JWT,
  requestHeaders: Pick<Headers, "get">,
  hasImpersonationCookie: boolean,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const authUrl = env.NEXTAUTH_URL?.trim();
  if (env.BAZAAR_APP_REVIEW_ROUTING_ENABLED !== "1" || env.NODE_ENV !== "production" ||
      env.VERCEL_ENV !== "production" || (authUrl !== productionOrigin && authUrl !== `${productionOrigin}/`)) {
    return null;
  }

  const reviewerId = env.BAZAAR_APP_REVIEW_USER_ID?.trim();
  const organizationId = env.BAZAAR_APP_REVIEW_ORGANIZATION_ID?.trim();
  // AppLayout supplies claims revalidated against the current account. The UA
  // selects the review-capable build and grants no access on its own.
  if (!reviewerId || !organizationId || hasImpersonationCookie || token.sub !== reviewerId ||
      token.organizationId !== organizationId || token.role !== "ADMIN" ||
      token.emailVerified !== true || token.isPlatformOwner !== false) {
    return null;
  }

  const host = requestHeaders.get("host")?.toLowerCase();
  const origin = requestHeaders.get("origin");
  if (host !== "www.bazaar.kg" || (origin !== null && origin !== productionOrigin) ||
      !reviewUserAgent.test(requestHeaders.get("user-agent") ?? "")) {
    return null;
  }

  // The other origin performs a separate sign-in. Nothing from this session is forwarded.
  return previewDashboard;
}
