// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import type { ImageProps } from "next/image";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketingLanding } from "@/components/marketing/MarketingLanding";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";

const state = vi.hoisted(() => ({ locale: "ru" as "ru" | "kg" | "en" }));
// Image loading/optimization is covered by the real-browser suite; this test
// renders document semantics without Next's client-only preload side effects.
vi.mock("next/image", () => ({ default: ({ alt, src, width, height }: ImageProps) => createElement("img", { alt, src: typeof src === "string" ? src : "", width, height }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getLocale: async () => state.locale,
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: state.locale, messages: { ru, kg, en }[state.locale], namespace }),
  };
});
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  return {
    ...actual,
    useLocale: () => state.locale,
    useTranslations: (namespace: string) =>
      actual.createTranslator({
        locale: state.locale,
        messages: { ru, kg, en }[state.locale],
        namespace,
      }),
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
  state.locale = "ru";
});
async function landing() {
  return new DOMParser().parseFromString(renderToStaticMarkup(await MarketingLanding()), "text/html");
}

describe("public marketing page contracts", () => {
  it.each(["ru", "kg", "en"] as const)(
    "server-renders complete %s copy, working destinations and honest demo labels",
    async (locale) => {
      state.locale = locale;
      const copy = { ru, kg, en }[locale].marketing;
      const page = await landing();
      expect(page.querySelectorAll("h1")).toHaveLength(1);
      expect(page.querySelector("h1")?.textContent).toBe(copy.hero.title + copy.hero.accent);
      expect(page.querySelector("main")?.textContent).not.toContain("marketing.");
      for (const id of ["platform", "workflows", "pricing", "faq"])
        expect(page.getElementById(id)).not.toBeNull();
      expect(page.querySelectorAll('a[href="/signup"]').length).toBeGreaterThanOrEqual(5);
      expect(page.querySelector('footer a[href="/privacy"]')).not.toBeNull();
      expect(page.querySelector('footer a[href="/help"]')).not.toBeNull();
      expect(page.querySelectorAll("details")).toHaveLength(4);
      expect(page.body.textContent).toContain(copy.preview.caption);
      expect(page.body.textContent).toContain(copy.showcase.caption);
      expect(page.querySelectorAll('[role="tab"]')).toHaveLength(3);
      expect(page.querySelectorAll('[role="tabpanel"]')).toHaveLength(3);
      for (const image of ["pos-desktop-wide.webp", "products-wide.webp", "dashboard-wide.webp"]) {
        expect(page.querySelector(`a[href="/marketing/captures/${image}"]`)).not.toBeNull();
      }
    },
  );

  it("uses current billing prices, fractional overrides, limits and trial length without promising Starter POS", async () => {
    vi.stubEnv("PLAN_PRICE_STARTER_KGS", "2100.5");
    vi.stubEnv("TRIAL_DAYS", "21");
    const page = await landing();
    const offers = JSON.parse(
      page.querySelector('script[type="application/ld+json"]')!.textContent!,
    ).offers;
    expect(offers[0]).toMatchObject({ price: "2100.5", priceCurrency: "KGS" });
    const plans = Array.from(page.querySelectorAll("#pricing article"));
    expect(plans[0].textContent).toContain(
      new Intl.NumberFormat("ru", { maximumFractionDigits: 2 }).format(2100.5),
    );
    expect(plans[0].textContent).not.toContain("POS");
    expect(plans[1].textContent).toContain("Касса POS");
    expect(plans[0].textContent).toContain("1 магазин");
    expect(plans[1].textContent).toContain("До 5 магазинов");
    expect(plans[2].textContent).toContain("До 15 магазинов");
    expect(page.body.textContent).toContain("21 день пробного доступа");
  });

  it("preserves indexed metadata, app redirect, isolated styles and immediate readable content", async () => {
    const [page, css, robots, sitemap] = await Promise.all([
      readFile("src/app/page.tsx", "utf8"),
      readFile("src/components/marketing/marketing.module.css", "utf8"),
      readFile("src/app/robots.ts", "utf8"),
      readFile("src/app/sitemap.ts", "utf8"),
    ]);
    for (const key of [
      "metadataBase",
      "openGraph",
      "twitter",
      "canonical",
      "getTranslations",
      'redirect("/dashboard")',
    ])
      expect(page).toContain(key);
    expect(page).not.toContain("@/components/ui/");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toContain("[data-reveal]");
    expect(robots).toContain('sitemap: "https://www.bazaar.kg/sitemap.xml"');
    expect(sitemap).toContain('url: "https://www.bazaar.kg/"');
  });
});
