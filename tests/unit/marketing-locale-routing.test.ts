import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn().mockResolvedValue(null) }));

import { middleware } from "@/middleware";
import {
  marketingLanguageDestination,
  marketingLocaleFromPath,
  marketingLocaleHeader,
} from "@/lib/marketingSeo";

describe("indexable marketing language routes", () => {
  it.each(["ru", "kg", "en"])("renders /%s without redirecting or following a conflicting cookie/header", async (locale) => {
    const response = await middleware(new NextRequest(`https://www.bazaar.kg/${locale}`, {
      headers: {
        cookie: `NEXT_LOCALE=${locale === "ru" ? "en" : "ru"}`,
        "accept-language": "en-US",
        [marketingLocaleHeader]: "fr",
      },
    }));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get(`x-middleware-request-${marketingLocaleHeader}`)).toBe(locale);
    expect(response.cookies.get("NEXT_LOCALE")?.value).toBe(locale);
  });

  it.each(["/", "/signup", "/privacy", "/fr"])("strips an externally supplied locale-routing header on %s", async (path) => {
    const response = await middleware(new NextRequest(`https://www.bazaar.kg${path}`, {
      headers: { [marketingLocaleHeader]: "kg" },
    }));
    expect(response.headers.get(`x-middleware-request-${marketingLocaleHeader}`)).toBeNull();
  });

  it("preserves signup query values and the locale cookie for legacy prefixed links", async () => {
    const response = await middleware(new NextRequest("https://www.bazaar.kg/en/signup?tag=a&tag=b&utm_campaign=launch"));
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/signup");
    expect(destination.searchParams.getAll("tag")).toEqual(["a", "b"]);
    expect(destination.searchParams.get("utm_campaign")).toBe("launch");
    expect(response.cookies.get("NEXT_LOCALE")?.value).toBe("en");
  });

  it("keeps authentication protection after removing a private-route locale prefix", async () => {
    const alias = await middleware(new NextRequest("https://www.bazaar.kg/kg/products?storeId=demo"));
    const destination = alias.headers.get("location")!;
    expect(new URL(destination).pathname).toBe("/products");
    const response = await middleware(new NextRequest(destination));
    const login = new URL(response.headers.get("location")!);
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("next")).toBe("/products?storeId=demo");
  });

  it.each(["/ru/signup", "/ru/products", "/russian", "/fr", "/en/other"])("does not treat %s as a localized landing", (path) => {
    expect(marketingLocaleFromPath(path)).toBeUndefined();
  });

  it("changes the public landing language without dropping campaign labels or the chosen section", () => {
    expect(marketingLanguageDestination("kg", "https://www.bazaar.kg/ru?utm_source=instagram&utm_campaign=launch#pricing"))
      .toBe("/kg?utm_source=instagram&utm_campaign=launch#pricing");
    expect(marketingLanguageDestination("en", "https://www.bazaar.kg/?utm_medium=social"))
      .toBe("/en?utm_medium=social");
    expect(marketingLanguageDestination("ru", "https://www.bazaar.kg/signup?next=demo"))
      .toBeUndefined();
    expect(marketingLanguageDestination("fr", "https://www.bazaar.kg/ru"))
      .toBeUndefined();
  });
});
