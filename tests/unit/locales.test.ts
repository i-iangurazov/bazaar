import { afterEach, describe, expect, it, vi } from "vitest";

import { getLocaleFromAcceptLanguage } from "@/lib/locales";

describe("getLocaleFromAcceptLanguage", () => {
  it("returns the first supported locale", () => {
    expect(getLocaleFromAcceptLanguage("ru-RU,kg;q=0.8")).toBe("ru");
  });

  it("maps ky to kg", () => {
    expect(getLocaleFromAcceptLanguage("ky-KG,ru;q=0.5")).toBe("kg");
  });

  it("returns undefined when no supported locale is present", () => {
    expect(getLocaleFromAcceptLanguage("en-US,en;q=0.9")).toBeUndefined();
  });
});

describe("locale API cookie flags", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets secure locale cookie in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { POST } = await import("@/app/api/locale/route");

    const response = await POST(
      new Request("http://localhost/api/locale", {
        method: "POST",
        body: JSON.stringify({ locale: "ru" }),
      }),
    );

    expect(response.status).toBe(204);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("Secure");
  });

  it("does not set secure locale cookie outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.resetModules();
    const { POST } = await import("@/app/api/locale/route");

    const response = await POST(
      new Request("http://localhost/api/locale", {
        method: "POST",
        body: JSON.stringify({ locale: "kg" }),
      }),
    );

    expect(response.status).toBe(204);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain("Secure");
  });
});
