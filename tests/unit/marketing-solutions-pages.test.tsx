// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";
import { getSolutionsCopy } from "@/content/solutions";
import { solutionPresentation } from "@/content/solutions/presentation";
import { getMarketingCopy } from "@/content/marketing";
import { getHelpGuide } from "@/content/help/catalog";
import { locales, type Locale } from "@/lib/locales";
import {
  marketingSolutionPath,
  marketingSolutionsLanguageAlternates,
  solutionPages,
} from "@/lib/marketingSolutions";
import { getSolutionMetadata } from "@/lib/solutionsMetadata";
import { getPlanCatalogEntries } from "@/server/billing/planCatalog";

const messages = { ru, kg, en };
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale }: { locale: Locale }) =>
    createTranslator({
      locale,
      messages: messages[locale],
      namespace: "billing",
      onError: (error) => {
        throw error;
      },
    }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/image", () => ({
  default: ({
    priority: _priority,
    quality: _quality,
    ...props
  }: {
    priority?: boolean;
    quality?: number;
    src: string;
    alt: string;
  }) => <img {...props} />,
}));

import { SolutionsPage } from "@/components/marketing/SolutionsPage";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import sitemap from "@/app/sitemap";

beforeEach(() => vi.stubGlobal("scrollTo", vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const provider = (locale: Locale, child: React.ReactNode) => (
  <NextIntlClientProvider locale={locale} messages={messages[locale]}>
    {child}
  </NextIntlClientProvider>
);
const cases = locales.flatMap((locale) =>
  [undefined, ...solutionPages.map((page) => page.id)].map((id) => ({ locale, id })),
);

describe("public solution pages", () => {
  it.each(cases)(
    "renders $locale/$id server content, real offers and real routes",
    async ({ locale, id }) => {
      const element = await SolutionsPage({ locale, id });
      const root = document.createElement("div");
      root.innerHTML = renderToStaticMarkup(provider(locale, element));
      const copy = getSolutionsCopy(locale);
      expect(root.querySelectorAll("h1")).toHaveLength(1);
      expect(root.querySelector("h1")?.textContent).toBe(copy.pages[id ?? "retail"].title);
      expect(root.querySelector('a[href="/signup"]')).not.toBeNull();
      expect(root.querySelector('a[href="/' + locale + '#pricing"]')).not.toBeNull();
      // Public copy is present in initial HTML, not loaded after a tab click.
      for (const section of copy.pages[id ?? "retail"].sections)
        expect(root.textContent).toContain(section.body);
      expect(root.querySelectorAll("details")).toHaveLength(3);
      const graph = JSON.parse(
        root.querySelector('script[type="application/ld+json"]')!.textContent!,
      )["@graph"];
      const pageUrl = "https://www.bazaar.kg" + marketingSolutionPath(locale, id);
      const webPage = graph.find((node: { "@id": string }) => node["@id"] === pageUrl + "#page");
      expect(webPage.url).toBe(pageUrl);
      expect(webPage.inLanguage).toBe(locale === "kg" ? "ky" : locale);
      expect(webPage["@type"]).toBe(
        id === "store-guide" ? "TechArticle" : id ? "WebPage" : "CollectionPage",
      );
      const app = graph.find(
        (node: { "@type": string }) => node["@type"] === "SoftwareApplication",
      );
      expect(app.offers.map((offer: { price: string }) => offer.price)).toEqual(
        getPlanCatalogEntries().map((plan) => String(plan.monthlyPriceKgs)),
      );
      expect(
        app.offers.every((offer: { priceCurrency: string }) => offer.priceCurrency === "KGS"),
      ).toBe(true);
      for (const plan of getPlanCatalogEntries()) {
        const card = root.querySelector(`[data-plan="${plan.code}"]`)!;
        expect(card.textContent).toContain(
          new Intl.NumberFormat(locale === "kg" ? "ky-KG" : locale).format(plan.limits.maxProducts),
        );
        expect(card.querySelector('a[href="/signup"]')).not.toBeNull();
      }
      for (const feature of solutionPresentation[id ?? "retail"].features) {
        const cells = root.querySelectorAll(`tr[data-feature="${feature}"] td`);
        expect([...cells].map((cell) => cell.getAttribute("data-included"))).toEqual(
          getPlanCatalogEntries().map((plan) => String(plan.features[feature])),
        );
      }
      expect(root.textContent).not.toMatch(/undefined|NaN|Lorem ipsum|TODO/);
    },
  );

  it.each(cases)(
    "gives $locale/$id a self canonical and reciprocal language alternatives",
    ({ locale, id }) => {
      const meta = getSolutionMetadata(locale, id);
      expect(meta.alternates?.canonical).toBe(marketingSolutionPath(locale, id));
      expect(meta.alternates?.languages).toEqual(marketingSolutionsLanguageAlternates(id));
      expect(meta.robots).toEqual({ index: true, follow: true });
      expect(meta.description).toBe(getSolutionsCopy(locale).pages[id ?? "retail"].description);
    },
  );

  it("publishes exactly one canonical sitemap entry for each solution in each language", () => {
    const entries = sitemap();
    const urls = entries.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const { locale, id } of cases) {
      expect(
        entries.find(
          (entry) => entry.url === "https://www.bazaar.kg" + marketingSolutionPath(locale, id),
        )?.alternates?.languages,
      ).toEqual(marketingSolutionsLanguageAlternates(id));
    }
    expect(urls.filter((url) => url.includes("/solutions"))).toHaveLength(21);
    expect(urls.some((url) => url.includes("/ky/") || url.includes("?"))).toBe(false);
  });

  it("connects every instructional link to an existing public guide", () => {
    for (const presentation of Object.values(solutionPresentation)) {
      for (const { category, slug } of presentation.guides)
        expect(getHelpGuide(category, slug), `${category}/${slug}`).toBeDefined();
    }
  });

  it("keeps POS fiscalization unavailable in the public grants matrix", async () => {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(
      provider("ru", await SolutionsPage({ locale: "ru", id: "pos" })),
    );
    expect(
      [...root.querySelectorAll('tr[data-feature="kkm"] td')].map((cell) =>
        cell.getAttribute("data-included"),
      ),
    ).toEqual(["false", "false", "false"]);
  });

  it("lets the mobile menu navigate to another page instead of swallowing its link", () => {
    render(
      provider(
        "ru",
        <MarketingNav
          copy={getMarketingCopy("ru").nav}
          homeHref="/ru"
          landingHref="/ru"
          solutionsLink={{ href: "/ru/solutions", label: "Решения" }}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: getMarketingCopy("ru").nav.open }));
    const links = screen.getAllByRole("link", { name: "Решения" });
    let swallowed: boolean | undefined;
    document.addEventListener(
      "click",
      (event) => {
        swallowed = event.defaultPrevented;
        event.preventDefault(); // Keep JSDOM from trying to open a real page.
      },
      { once: true },
    );
    expect(links[links.length - 1].getAttribute("href")).toBe("/ru/solutions");
    fireEvent.click(links[links.length - 1]);
    expect(swallowed).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
