const officialHosts = new Set(["bazaar.kg", "www.bazaar.kg"]);

const cleanId = (value: string | undefined) => {
  const decoded = decodeURIComponent(value ?? "").trim();
  return /^[A-Za-z0-9_-]{1,160}$/.test(decoded) ? decoded : null;
};

const allowedWebPrefixes = [
  "/dashboard",
  "/products",
  "/inventory",
  "/pos",
  "/sales/orders",
  "/purchase-orders",
  "/customers",
  "/reports",
  "/operations/integrations",
  "/help",
  "/settings",
];

export const parseNativeDeepLink = (rawUrl: string): string | null => {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "bazaar:") {
      const segments = url.pathname.split("/").filter(Boolean);
      const resource = url.hostname.toLowerCase();
      if (resource === "pos") return "/pos/sell";
      if (resource === "orders") {
        if (segments.length === 0) return "/sales/orders";
        const id = cleanId(segments[0]);
        return id ? `/sales/orders/${encodeURIComponent(id)}` : null;
      }
      if (resource === "products") {
        if (segments.length === 0) return "/products";
        const id = cleanId(segments[0]);
        return id ? `/products/${encodeURIComponent(id)}` : null;
      }
      if (resource === "inventory") return "/inventory";
      if (resource === "help") return `/help${url.pathname}`;
      return null;
    }

    if (url.protocol !== "https:" || !officialHosts.has(url.hostname.toLowerCase())) return null;
    if (
      !allowedWebPrefixes.some(
        (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
      )
    ) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
};
