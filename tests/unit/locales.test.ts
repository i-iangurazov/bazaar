import { afterEach, describe, expect, it, vi } from "vitest";

import { getLocaleFromAcceptLanguage, normalizeLocale } from "@/lib/locales";

describe("normalizeLocale", () => {
  it.each(["constructor", "toString", "__proto__"])("rejects inherited property %s as an unsupported locale", (value) => {
    expect(normalizeLocale(value)).toBeUndefined();
  });

  it.each(["ru", "kg", "en"])("preserves supported locale %s", (locale) => {
    expect(normalizeLocale(locale)).toBe(locale);
  });

  it("retains the explicit legacy ky to kg mapping", () => {
    expect(normalizeLocale("ky")).toBe("kg");
  });
});

describe("getLocaleFromAcceptLanguage", () => {
  it("returns the first supported locale", () => {
    expect(getLocaleFromAcceptLanguage("ru-RU,kg;q=0.8")).toBe("ru");
  });

  it("maps ky to kg", () => {
    expect(getLocaleFromAcceptLanguage("ky-KG,ru;q=0.5")).toBe("kg");
  });

  it("returns en from English accept-language headers", () => {
    expect(getLocaleFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
  });

  it("returns undefined when no supported locale is present", () => {
    expect(getLocaleFromAcceptLanguage("fr-FR,de;q=0.9")).toBeUndefined();
  });

  it("ignores an inherited property before a real language preference", () => {
    expect(getLocaleFromAcceptLanguage("constructor,ru;q=0.5")).toBe("ru");
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
