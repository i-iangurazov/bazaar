import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

describe("public search discovery", () => {
  it("lists stable language-specific canonical URLs with reciprocal valid language alternatives", () => {
    const entries = sitemap();
    const urls = entries.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const path of ["/ru", "/kg", "/en"]) {
      expect(entries.find((entry) => entry.url === `https://www.bazaar.kg${path}`)?.alternates?.languages)
        .toEqual({
          "ru-KG": "https://www.bazaar.kg/ru",
          "ky-KG": "https://www.bazaar.kg/kg",
          en: "https://www.bazaar.kg/en",
          "x-default": "https://www.bazaar.kg/",
        });
    }
    expect(urls).toContain("https://www.bazaar.kg/privacy");
    expect(urls).toContain("https://www.bazaar.kg/signup");
    expect(urls).toContain("https://www.bazaar.kg/developers/bazaar-api");
    expect(urls).not.toContain("https://www.bazaar.kg/");
    for (const url of urls) {
      expect(new URL(url).search).toBe("");
      expect(new URL(url).pathname).not.toMatch(/^\/(?:api|dashboard|settings|register-business|verify|reset)(?:\/|$)/);
    }
  });

  it("keeps the public landing and help discoverable while excluding operational/token routes", () => {
    const value = robots();
    const rule = Array.isArray(value.rules) ? value.rules[0] : value.rules;
    expect(value.sitemap).toBe("https://www.bazaar.kg/sitemap.xml");
    expect(rule.allow).toContain("/");
    expect(rule.disallow).toEqual(expect.arrayContaining([
      "/api/", "/baam", "/dev/", "/help/compliance", "/dashboard",
      "/settings/", "/register-business/", "/verify/", "/reset/", "/invite",
    ]));
    expect(rule.disallow).not.toContain("/help");
    expect(rule.disallow).not.toContain("/ru");
    expect(rule.disallow).not.toContain("/kg");
    expect(rule.disallow).not.toContain("/en");
  });
});
