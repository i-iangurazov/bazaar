import type { NextRequest } from "next/server";

import { helpCategories, helpGuides } from "@/content/help/catalog";
import { isMarketingLandingPath, marketingSiteUrl } from "@/lib/marketingSeo";
import { marketingSolutionPath, parseMarketingSolutionPath } from "@/lib/marketingSolutions";

const duplicateHosts = new Set(["bazaarpos.app", "www.bazaarpos.app"]);
const publicDocumentPaths = new Set([
  "/privacy",
  "/developers/bazaar-api",
  "/help",
  ...helpCategories.map(({ slug }) => `/help/${slug}`),
  ...helpGuides.map(({ category, slug }) => `/help/${category}/${slug}`),
]);

// Keep existing sessions on their origin, including chunked NextAuth cookies.
// This is a routing precaution, not authentication or an authorization check.
export const hasLegacySiteSessionCookie = (request: NextRequest) =>
  request.cookies.getAll().some(({ name, value }) =>
    /^(?:__Secure-)?next-auth\.session-token(?:\.\d+)?$/.test(name) && Boolean(value),
  );

export const publicSiteRedirect = (request: NextRequest): URL | undefined => {
  // Next's server-bound URL can use its internal hostname behind a proxy.
  // Match the actual HTTP Host, never visitor-supplied forwarded-host headers.
  const hostname = request.headers.get("host")?.toLowerCase().replace(/:\d+$/, "")
    ?? request.nextUrl.hostname;
  if (
    !duplicateHosts.has(hostname) ||
    (request.method !== "GET" && request.method !== "HEAD")
  ) return undefined;

  const { pathname, search } = request.nextUrl;
  const documentPath = pathname.replace(/^\/(?:ru|kg|ky|en)(?=\/)/, "");
  if (!isMarketingLandingPath(pathname) && !publicDocumentPaths.has(documentPath)) {
    return undefined;
  }

  const solution = parseMarketingSolutionPath(pathname);
  const destinationPath = solution?.isAlias
    ? marketingSolutionPath(solution.locale, solution.id)
    : pathname === "/ky" || pathname === "/ky/" ? "/kg" : pathname;
  // The target origin is fixed. Do not trust forwarded hosts or a query target.
  // Preserve the original query, including repeated UTM values and click IDs.
  return new URL(`${destinationPath}${search}`, marketingSiteUrl);
};
