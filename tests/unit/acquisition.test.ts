import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn().mockResolvedValue(null) }));
import { middleware } from "@/middleware";
import { acquisitionCookieName, acquisitionFromSearch, parseAcquisition } from "@/lib/acquisition";

const tagged =
  "utm_source=instagram&utm_medium=organic_social&utm_campaign=kg_store_launch_202611&utm_content=r01_ru";
describe("campaign acquisition", () => {
  it("accepts only campaign labels and strips personal data, URLs and click IDs", () => {
    const value = acquisitionFromSearch(
      new URLSearchParams(`${tagged}&utm_term=a@example.com&fbclid=private&email=private`),
    );
    expect(value).toMatchObject({ utm_source: "instagram", utm_content: "r01_ru" });
    expect(value).not.toHaveProperty("utm_term");
    expect(value).not.toHaveProperty("email");
    expect(value).not.toHaveProperty("fbclid");
    expect(acquisitionFromSearch(new URLSearchParams("utm_content=x"))).toBeUndefined();
  });
  it("ignores malformed, future, expired and oversized cookies", () => {
    const now = new Date("2026-11-03T00:00:00Z");
    const value = acquisitionFromSearch(new URLSearchParams(tagged), now);
    expect(parseAcquisition(JSON.stringify(value), now)).toEqual(value);
    expect(parseAcquisition("null", now)).toBeUndefined();
    expect(parseAcquisition("{", now)).toBeUndefined();
    expect(parseAcquisition("a".repeat(1201), now)).toBeUndefined();
    expect(parseAcquisition(JSON.stringify(value), new Date("2026-11-02"))).toBeUndefined();
    expect(parseAcquisition(JSON.stringify(value), new Date("2026-12-03"))).toBeUndefined();
  });
  it.each(["/", "/ru", "/kg", "/en", "/signup"])("captures first tagged touch on %s and preserves it", async (path) => {
    const response = await middleware(new NextRequest(`https://www.bazaar.kg${path}?${tagged}`));
    const cookie = response.cookies.get(acquisitionCookieName)!;
    expect(parseAcquisition(cookie.value)?.utm_content).toBe("r01_ru");
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 2592000,
    });
    const next = await middleware(
      new NextRequest(`https://www.bazaar.kg${path}?${tagged}&utm_term=second`, {
        headers: { cookie: `${acquisitionCookieName}=${encodeURIComponent(cookie.value)}` },
      }),
    );
    expect(next.cookies.get(acquisitionCookieName)).toBeUndefined();
  });
  it.each(["/products", "/c/store", "/privacy"])("does not capture on %s", async (path) => {
    const response = await middleware(new NextRequest(`https://www.bazaar.kg${path}?${tagged}`));
    expect(response.cookies.get(acquisitionCookieName)).toBeUndefined();
  });
  it.each(["dnt", "sec-gpc", "next-router-prefetch", "purpose"])(
    "honours privacy and prefetch headers %s",
    async (header) => {
      const response = await middleware(
        new NextRequest(`https://www.bazaar.kg/?${tagged}`, {
          headers: { [header]: header === "purpose" ? "prefetch" : "1" },
        }),
      );
      expect(response.cookies.get(acquisitionCookieName)?.value).toBeFalsy();
    },
  );
  it("retains UTM across locale redirect then captures at the destination", async () => {
    const response = await middleware(new NextRequest(`https://www.bazaar.kg/ky?${tagged}`));
    const location = response.headers.get("location")!;
    expect(new URL(location).pathname).toBe("/kg");
    expect(new URL(location).searchParams.get("utm_content")).toBe("r01_ru");
    const landing = await middleware(new NextRequest(location));
    expect(parseAcquisition(landing.cookies.get(acquisitionCookieName)?.value)?.utm_source).toBe(
      "instagram",
    );
  });
});
