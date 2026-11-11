export function appleNativeOriginAllowed(raw: string | null, env: Record<string, string | undefined> = process.env) {
  try {
    if (!raw) return false;
    const parsed = new URL(raw);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return false;
    const origin = parsed.origin;
    if (origin === "https://www.bazaar.kg") return true;
    if (env.VERCEL_ENV !== "preview" || env.APPLE_BILLING_MODE !== "sandbox" || !env.APPLE_BILLING_PREVIEW_ORIGIN) return false;
    const configured = new URL(env.APPLE_BILLING_PREVIEW_ORIGIN);
    return configured.protocol === "https:" && !configured.username && !configured.password && configured.pathname === "/" &&
      !configured.search && !configured.hash && origin === configured.origin;
  } catch { return false; }
}
