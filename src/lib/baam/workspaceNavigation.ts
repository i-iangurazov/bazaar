import { appRoutes } from "@/lib/appRoutes";
import { normalizeLocale } from "@/lib/locales";
import { resolveSafeReturnTo } from "@/lib/safeReturnTo";

export function baamPathname(pathname: string) {
  const segments = pathname.split(/[?#]/, 1)[0].split("/");
  if (normalizeLocale(segments[1])) segments.splice(1, 1);
  return segments.join("/").replace(/\/+$/, "") || "/";
}

export function baamWorkspaceReturnHref(value: string | null | undefined) {
  const destination = resolveSafeReturnTo(value, "/dashboard");
  const path = baamPathname(destination);
  return path === appRoutes.baam || path.startsWith(`${appRoutes.baam}/`)
    ? "/dashboard"
    : destination;
}

/** Keep the originating workspace/filter and an explicit store hint on iOS. */
export function nativeBaamWorkspaceHref(location: { pathname: string; search: string; hash: string }) {
  const query = new URLSearchParams();
  const storeId = new URLSearchParams(location.search).get("storeId");
  if (storeId && /^[A-Za-z0-9_-]{1,160}$/.test(storeId)) query.set("storeId", storeId);
  query.set("returnTo", baamWorkspaceReturnHref(`${location.pathname}${location.search}${location.hash}`));
  return `${appRoutes.baam}?${query}`;
}
