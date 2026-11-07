import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "@/middleware";
import { LEGAL_TERMS_VERSION } from "@/lib/legalPublication";
import { syntheticSellerEnvironment } from "../helpers/legalSeller";

afterEach(() => vi.unstubAllEnvs());

describe("unpublished legal HTTP responses", () => {
  it.each([
    "/legal",
    "/legal/offer",
    "/legal/refunds",
    "/legal/requisites",
    "/legal/payment",
    "/ru/legal/offer",
    "/kg/legal/refunds",
    "/ky/legal/requisites",
    "/en/legal/payment?preview=1",
  ])("returns an empty uncached 404 before rendering %s in production", async (pathname) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BAZAAR_LEGAL_PREVIEW", "1");
    const response = await middleware(
      new NextRequest(`http://localhost:3134${pathname}`, {
        headers: { host: "localhost:3134", RSC: "1" },
      }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(await response.text()).toBe("");
  });

  it("allows explicitly enabled localhost development only", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BAZAAR_LEGAL_PREVIEW", "1");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("VERCEL", "0");
    const response = await middleware(
      new NextRequest("http://localhost:3134/legal/offer", {
        headers: { host: "localhost:3134" },
      }),
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["/", "/privacy", "/help", "/legal-advice"])(
    "leaves the existing public route %s unaffected",
    async (pathname) => {
      vi.stubEnv("NODE_ENV", "production");
      const response = await middleware(new NextRequest(`https://bazaar.test${pathname}`));
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it("passes the approved public pages only after all publication checks", async () => {
    for (const [key, value] of Object.entries(syntheticSellerEnvironment)) vi.stubEnv(key, value);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BILLING_LEGAL_RELEASE_APPROVED", LEGAL_TERMS_VERSION);
    vi.stubEnv("BILLING_SUPPORT_EMAIL_VERIFIED", "1");
    vi.stubEnv("BILLING_PUBLIC_CONTACT_ADDRESS", "Кыргызстан, Бишкек, тестовый адрес 1");
    for (const id of ["offer", "refunds", "requisites", "payment"]) {
      const response = await middleware(new NextRequest(`https://bazaar.kg/legal/${id}`));
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
    vi.stubEnv("BILLING_SUPPORT_EMAIL_VERIFIED", "0");
    expect((await middleware(new NextRequest("https://bazaar.kg/legal/offer"))).status).toBe(404);
  });
});
