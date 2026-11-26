import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import sitemap from "@/app/sitemap";
import { acquisitionCookieName, parseAcquisition } from "@/lib/acquisition";
import { middleware, protectedPrefixes } from "@/middleware";

const secret = "public-redirect-isolated-session-secret";
const query = "utm_source=instagram&utm_medium=organic_social&utm_campaign=kg_store_launch_202611&utm_content=r01_ru&gclid=example-click&fbclid=example-meta&tag=a&tag=b";
const request = (path: string, options: ConstructorParameters<typeof NextRequest>[1] = {}) =>
  new NextRequest(`https://bazaarpos.app${path}`, options);

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", secret);
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => vi.unstubAllEnvs());

describe("duplicate public site consolidation", () => {
  it.each([
    ["bazaarpos.app", "GET"], ["bazaarpos.app", "HEAD"],
    ["www.bazaarpos.app", "GET"], ["www.bazaarpos.app", "HEAD"],
  ])("redirects indexable public documents on %s for %s, preserving the complete URL query", async (host, method) => {
    // Sitemap is the public publishing contract. Signup is a separate auth flow.
    const paths = ["/", ...sitemap().map(({ url }) => new URL(url).pathname)
      .filter((path) => path !== "/signup")];
    for (const path of paths) {
      const response = await middleware(new NextRequest(`https://${host}${path}?${query}`, { method }));
      expect(response.status, path).toBe(308);
      expect(response.headers.get("location"), path).toBe(`https://www.bazaar.kg${path}?${query}`);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")).toContain("Cookie");
      expect(response.cookies.get(acquisitionCookieName)).toBeUndefined();
    }
  });

  it.each([
    ["/ky", "/kg"],
    ["/ky/solutions/inventory-management", "/kg/solutions/inventory-management"],
    ["/kg/help/pos/make-sale", "/kg/help/pos/make-sale"],
    ["/en/privacy", "/en/privacy"],
    ["/ru/developers/bazaar-api", "/ru/developers/bazaar-api"],
  ])("retains the language of the public alias %s", async (path, expected) => {
    const response = await middleware(request(`${path}?tag=a&tag=b`));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`https://www.bazaar.kg${expected}?tag=a&tag=b`);
    if (path.startsWith("/kg/help")) {
      const target = await middleware(new NextRequest(response.headers.get("location")!));
      expect(new URL(target.headers.get("location")!).pathname).toBe("/help/pos/make-sale");
      expect(target.cookies.get("NEXT_LOCALE")?.value).toBe("kg");
    }
  });

  it("captures acquisition on the destination origin and retains click IDs for its consent flow", async () => {
    const redirected = await middleware(request(`/ru?${query}`));
    const location = redirected.headers.get("location")!;
    expect(new URL(location).searchParams.get("gclid")).toBe("example-click");
    expect(new URL(location).searchParams.get("fbclid")).toBe("example-meta");
    expect(new URL(location).searchParams.getAll("tag")).toEqual(["a", "b"]);
    const landing = await middleware(new NextRequest(location));
    expect(landing.headers.get("location")).toBeNull();
    expect(parseAcquisition(landing.cookies.get(acquisitionCookieName)?.value)?.utm_content).toBe("r01_ru");
  });

  it.each(["www.bazaar.kg", "bazaar.kg", "bazaar-five.vercel.app", "bazaarpos.app.evil.invalid", "preview.bazaarpos.app"])(
    "does not introduce a host redirect on %s", async (host) => {
      const response = await middleware(new NextRequest(`https://${host}/ru`, {
        headers: { "x-forwarded-host": "bazaarpos.app" },
      }));
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it("does not allow host or destination query values to choose the redirect target", async () => {
    const response = await middleware(request("/ru?next=https%3A%2F%2Fevil.invalid&redirect=https%3A%2F%2Fevil.invalid", {
      headers: { "x-forwarded-host": "evil.invalid" },
    }));
    expect(new URL(response.headers.get("location")!).origin).toBe("https://www.bazaar.kg");
  });

  it("recognizes the actual host when the server-bound URL uses an internal hostname", async () => {
    const response = await middleware(new NextRequest("http://127.0.0.1:3149/ru?tag=a&tag=b", {
      headers: { host: "BazaarPos.App:3149", "x-forwarded-host": "evil.invalid" },
    }));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://www.bazaar.kg/ru?tag=a&tag=b");
    const officialHost = await middleware(new NextRequest("https://bazaarpos.app/ru", {
      headers: { host: "www.bazaar.kg", "x-forwarded-host": "bazaarpos.app" },
    }));
    expect(officialHost.headers.get("location")).toBeNull();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("does not redirect a %s payload across domains", async (method) => {
    const response = await middleware(request("/ru", { method }));
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("application, sessions and external endpoints retain their origin", () => {
  it.each([
    "/login?next=%2Fdashboard", "/signup?invite=example", "/invite/example",
    "/verify/example", "/reset/example", "/register-business/example",
    "/c/store-example", "/loyalty/join/example", "/loyalty/card",
    "/api/auth/session", "/api/auth/callback/credentials", "/api/trpc/auth.signup",
    "/api/bazaar/v1/orders", "/api/mobile/config", "/api/mobile/devices",
    "/api/billing/apple/notifications", "/api/billing/freedompay/result",
    "/api/integrations/whatsapp/connection-example", "/api/sse",
    "/.well-known/apple-app-site-association", "/robots.txt", "/sitemap.xml",
    "/_next/static/example.js", "/sw.js", "/manifest.webmanifest",
    "/uploads/imported-products/example/image.jpg", "/help/unknown/unknown",
  ])("does not change the origin of %s", async (path) => {
    const response = await middleware(request(path));
    expect(response.headers.get("location")).toBeNull();
  });

  it.each(protectedPrefixes)("keeps unauthenticated %s protected on the source host", async (path) => {
    const response = await middleware(request(`${path}?storeId=example`));
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://bazaarpos.app");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(`${path}?storeId=example`);
  });

  it.each(["__Secure-next-auth.session-token", "next-auth.session-token", "__Secure-next-auth.session-token.0"])(
    "keeps existing public-page/session behavior for cookie %s", async (name) => {
      for (const path of ["/", "/ru", "/help/pos/make-sale"]) {
        const response = await middleware(request(path, { headers: { cookie: `${name}=existing-session` } }));
        expect(response.headers.get("location")).toBeNull();
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("vary")).toContain("Cookie");
      }
    },
  );

  it("preserves source-host locale normalization for session-bearing public aliases", async () => {
    const response = await middleware(request("/kg/help/pos/make-sale", {
      headers: { cookie: "__Secure-next-auth.session-token=existing-session" },
    }));
    expect(response.headers.get("location")).toBe("https://bazaarpos.app/help/pos/make-sale");
    expect(response.cookies.get("NEXT_LOCALE")?.value).toBe("kg");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("accepts a signed application session and retains role-based route restrictions", async () => {
    const token = await encode({ secret, token: { sub: "isolated-user", role: "CASHIER", organizationId: "isolated-org" } });
    const headers = { cookie: `__Secure-next-auth.session-token=${token}` };
    const pos = await middleware(request("/pos", { headers }));
    expect(pos.headers.get("location")).toBeNull();
    const denied = await middleware(request("/settings/users", { headers }));
    const destination = new URL(denied.headers.get("location")!);
    expect(destination.origin).toBe("https://bazaarpos.app");
    expect(destination.pathname).toBe("/pos");
  });

  it("does not treat a forged session cookie as authorization", async () => {
    const response = await middleware(request("/dashboard", {
      headers: { cookie: "__Secure-next-auth.session-token=forged" },
    }));
    expect(response.headers.get("location")).toBe("https://bazaarpos.app/login?next=%2Fdashboard");
  });

  it.each(["/ru/solutions/missing", "/legal/not-published", "/legal/apple-purchases/unknown"])(
    "preserves the existing 404 for %s", async (path) => {
      const response = await middleware(request(path));
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it("keeps locale-prefixed compliance access protected instead of moving it to another domain", async () => {
    const alias = await middleware(request("/ru/help/compliance"));
    expect(alias.headers.get("location")).toBe("https://bazaarpos.app/help/compliance");
    const protectedPage = await middleware(new NextRequest(alias.headers.get("location")!));
    expect(new URL(protectedPage.headers.get("location")!).pathname).toBe("/login");
  });
});
