import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getToken } = vi.hoisted(() => ({ getToken: vi.fn().mockResolvedValue(null) }));
vi.mock("next-auth/jwt", () => ({ getToken }));

import { acquisitionCookieName, parseAcquisition } from "@/lib/acquisition";
import {
  marketingLanguageDestination,
  marketingLocaleFromPath,
  marketingLocaleHeader,
  marketingSiteUrl,
} from "@/lib/marketingSeo";
import {
  getSolutionBySlug,
  marketingSolutionPath,
  marketingSolutionsLanguageAlternates,
  parseMarketingSolutionPath,
  solutionPages,
  type SolutionId,
} from "@/lib/marketingSolutions";
import { middleware } from "@/middleware";

const ids: Array<SolutionId | null> = [null, ...solutionPages.map((page) => page.id)];
const canonicalPaths = ["ru", "kg", "en"].flatMap((locale) =>
  ids.map((id) => ({ locale, id, path: marketingSolutionPath(locale, id) })),
);
const tagged = "utm_source=instagram&utm_medium=organic_social&utm_campaign=kg_store_launch_202611&utm_content=r01_ru";

beforeEach(() => {
  vi.clearAllMocks();
  getToken.mockResolvedValue(null);
});

describe("registered public solution routes", () => {
  it("has six distinct detail pages and a separate hub with no arbitrary slug interpolation", () => {
    expect(solutionPages).toHaveLength(6);
    expect(new Set(solutionPages.map((page) => page.id)).size).toBe(6);
    expect(new Set(solutionPages.map((page) => page.slug)).size).toBe(6);
    for (const page of solutionPages) expect(getSolutionBySlug(page.slug)).toEqual(page);
    expect(getSolutionBySlug("products")).toBeUndefined();
    expect(marketingSolutionPath("ru")).toBe("/ru/solutions");
    expect(marketingSolutionPath("ky", "inventory")).toBe("/kg/solutions/inventory-management");
    expect(() => marketingSolutionPath("ru", "private" as SolutionId)).toThrow();
  });

  it.each(canonicalPaths)("serves $path anonymously in its URL language, not a forged header or cookie", async ({ path, locale, id }) => {
    expect(parseMarketingSolutionPath(path)).toEqual({ locale, id, isAlias: false });
    expect(marketingLocaleFromPath(path)).toBe(locale);
    const response = await middleware(new NextRequest(`${marketingSiteUrl}${path}`, {
      headers: {
        cookie: `NEXT_LOCALE=${locale === "ru" ? "en" : "ru"}`,
        "accept-language": "en-US",
        [marketingLocaleHeader]: "en",
      },
    }));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get(`x-middleware-request-${marketingLocaleHeader}`)).toBe(locale);
    expect(response.cookies.get("NEXT_LOCALE")?.value).toBe(locale);
    expect(getToken).not.toHaveBeenCalled();
  });

  it.each(ids)("uses reciprocal canonical language URLs for solution %s", (id) => {
    expect(marketingSolutionsLanguageAlternates(id)).toEqual({
      "ru-KG": `${marketingSiteUrl}${marketingSolutionPath("ru", id)}`,
      "ky-KG": `${marketingSiteUrl}${marketingSolutionPath("kg", id)}`,
      en: `${marketingSiteUrl}${marketingSolutionPath("en", id)}`,
      "x-default": `${marketingSiteUrl}${marketingSolutionPath("ru", id)}`,
    });
  });

  it.each(ids)("canonicalizes the Kyrgyz alias for %s without dropping its page or repeated query values", async (id) => {
    const canonical = marketingSolutionPath("kg", id);
    const alias = canonical.replace(/^\/kg\//, "/ky/");
    expect(parseMarketingSolutionPath(alias)).toEqual({ locale: "kg", id, isAlias: true });
    const response = await middleware(new NextRequest(`${marketingSiteUrl}${alias}?${tagged}&tag=a&tag=b`));
    const destination = new URL(response.headers.get("location")!);
    expect(response.status).toBe(308);
    expect(destination.pathname).toBe(canonical);
    expect(destination.searchParams.getAll("tag")).toEqual(["a", "b"]);
    expect(destination.searchParams.get("utm_campaign")).toBe("kg_store_launch_202611");
    expect(response.cookies.get("NEXT_LOCALE")?.value).toBe("kg");
    expect(response.cookies.get(acquisitionCookieName)).toBeUndefined();
    const landing = await middleware(new NextRequest(destination));
    expect(parseAcquisition(landing.cookies.get(acquisitionCookieName)?.value)?.utm_content).toBe("r01_ru");
  });

  it("retains the existing home alias behavior", async () => {
    const response = await middleware(new NextRequest(`${marketingSiteUrl}/ky?${tagged}`));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/kg");
  });

  it.each([
    "/ru/solutions/missing",
    "/kg/solutions/products",
    "/ky/solutions/missing",
    "/en/solutions/inventory-management/private",
    "/en/solutions/%2Finventory-management",
  ])("rejects unknown solution URL %s before legacy locale redirect and without source capture", async (path) => {
    const response = await middleware(new NextRequest(`${marketingSiteUrl}${path}?${tagged}`, {
      headers: { [marketingLocaleHeader]: "kg" },
    }));
    expect(response.status).toBe(404);
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get(`x-middleware-request-${marketingLocaleHeader}`)).toBeNull();
    expect(response.cookies.get(acquisitionCookieName)).toBeUndefined();
    expect(getToken).not.toHaveBeenCalled();
  });

  it.each([
    "/ru/products",
    "/fr/solutions/inventory-management",
    "/solutions/inventory-management",
    "/ru/solutions/inventory-management?email=private@example.invalid",
    "/ru/solutions/inventory-management#private",
    "/ru/solutions/inventory-management/",
    "/ru/solutionsx/inventory-management",
  ])("does not classify %s as a registered public solution", (path) => {
    expect(parseMarketingSolutionPath(path)).toBeUndefined();
  });

  it("keeps locale-prefixed private paths protected", async () => {
    const alias = await middleware(new NextRequest(`${marketingSiteUrl}/ru/products?storeId=private`));
    const destination = alias.headers.get("location")!;
    expect(new URL(destination).pathname).toBe("/products");
    const protectedResponse = await middleware(new NextRequest(destination));
    const login = new URL(protectedResponse.headers.get("location")!);
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("next")).toBe("/products?storeId=private");
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it.each(ids)("changes language on %s without changing the solution or losing campaign/fragment state", (id) => {
    const from = `${marketingSiteUrl}${marketingSolutionPath("ru", id)}?${tagged}#pricing`;
    expect(marketingLanguageDestination("kg", from)).toBe(`${marketingSolutionPath("kg", id)}?${tagged}#pricing`);
    expect(marketingLanguageDestination("en", from)).toBe(`${marketingSolutionPath("en", id)}?${tagged}#pricing`);
    expect(marketingLanguageDestination("fr", from)).toBeUndefined();
  });

  it("does not change unknown or private nested paths through the public language helper", () => {
    expect(marketingLanguageDestination("kg", `${marketingSiteUrl}/ru/products`)).toBeUndefined();
    expect(marketingLanguageDestination("kg", `${marketingSiteUrl}/ru/solutions/unknown`)).toBeUndefined();
  });
});

describe("solution landing acquisition boundary", () => {
  it.each(canonicalPaths)("preserves first touch through $path to the existing bare signup link", async ({ path }) => {
    const landing = await middleware(new NextRequest(`${marketingSiteUrl}${path}?${tagged}&email=private@example.invalid&fbclid=private-click`));
    const cookie = landing.cookies.get(acquisitionCookieName)!;
    const acquisition = parseAcquisition(cookie.value);
    expect(acquisition).toMatchObject({
      utm_source: "instagram", utm_medium: "organic_social",
      utm_campaign: "kg_store_launch_202611", utm_content: "r01_ru",
    });
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", maxAge: 2592000 });
    expect(cookie.value).not.toMatch(/private@example|private-click|fbclid|email/);
    const request = new NextRequest(`${marketingSiteUrl}/signup?utm_source=other&utm_medium=paid_social&utm_campaign=other`, {
      headers: { cookie: `${acquisitionCookieName}=${encodeURIComponent(cookie.value)}` },
    });
    const signup = await middleware(request);
    expect(signup.cookies.get(acquisitionCookieName)).toBeUndefined();
    expect(parseAcquisition(request.cookies.get(acquisitionCookieName)?.value)).toEqual(acquisition);
  });

  it.each(["dnt", "sec-gpc"])("removes previous acquisition on an opted-out solution visit with %s", async (header) => {
    const response = await middleware(new NextRequest(`${marketingSiteUrl}/ru/solutions?${tagged}`, {
      headers: { [header]: "1", cookie: `${acquisitionCookieName}=previous` },
    }));
    expect(response.cookies.get(acquisitionCookieName)?.value).toBe("");
  });

  it.each(["next-router-prefetch", "purpose"])("does not capture solution prefetches identified by %s", async (header) => {
    const response = await middleware(new NextRequest(`${marketingSiteUrl}/ru/solutions/inventory-management?${tagged}`, {
      headers: { [header]: header === "purpose" ? "prefetch" : "1" },
    }));
    expect(response.cookies.get(acquisitionCookieName)).toBeUndefined();
  });
});
