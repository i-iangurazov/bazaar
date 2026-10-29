// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";
import { getMarketingCopy } from "@/content/marketing";
import { getMarketingPreviewData } from "@/content/marketing/preview";
import { getPlanCatalogEntries } from "@/server/billing/planCatalog";

const state = vi.hoisted(() => ({
  locale: "ru",
  token: null as object | null,
  refresh: vi.fn(),
  fetch: vi.fn(),
}));
const messages = { ru, kg, en };
vi.mock("next-intl/server", () => ({
  getLocale: async () => state.locale,
  getMessages: async () => messages[state.locale as keyof typeof messages],
  getTranslations: async () =>
    createTranslator({
      locale: state.locale,
      messages: messages[state.locale as keyof typeof messages],
      namespace: "billing",
    }),
}));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "dark" }) }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: state.refresh }),
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("@/server/auth/token", () => ({ getServerAuthToken: async () => state.token }));
vi.mock("next/image", () => ({
  default: ({
    priority: _priority,
    ...props
  }: {
    priority?: boolean;
    src: string;
    alt: string;
  }) => <img {...props} />,
}));
import { MarketingLanding } from "@/components/marketing/MarketingLanding";
import { FeatureShowcase } from "@/components/marketing/FeatureShowcase";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { MarketingLocaleSwitcher } from "@/components/marketing/MarketingLocaleSwitcher";
import RootPage, { generateMetadata } from "@/app/page";
import RootLayout from "@/app/layout";

beforeEach(() => {
  vi.clearAllMocks();
  state.locale = "ru";
  state.token = null;
  vi.stubGlobal("fetch", state.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("localized public marketing", () => {
  it.each([
    ["ru", "ru"],
    ["kg", "ky-KG"],
    ["en", "en-US"],
  ])(
    "uses a valid %s HTML language and preserves the server dark theme",
    async (locale, htmlLanguage) => {
      state.locale = locale;
      const page = await RootLayout({ children: <div>content</div> });
      expect(page.props.lang).toBe(htmlLanguage);
      expect(page.props.className).toBe("dark");
    },
  );
  it.each(["ru", "kg", "en"] as const)(
    "renders the %s story, labels, metadata and authoritative plan prices in the same language",
    async (locale) => {
      state.locale = locale;
      const copy = getMarketingCopy(locale);
      const root = document.createElement("div");
      root.innerHTML = renderToStaticMarkup(
        <NextIntlClientProvider
          locale={locale}
          messages={{ common: messages[locale].common, errors: messages[locale].errors }}
        >
          {await MarketingLanding()}
        </NextIntlClientProvider>,
      );
      expect(root.querySelector("h1")?.textContent).toBe(copy.hero.title);
      expect(root.querySelector("#pos h2")?.textContent).toBe(copy.stories.pos.title);
      expect(root.querySelector("#inventory h2")?.textContent).toBe(copy.stories.inventory.title);
      expect(root.querySelector("nav[aria-label]")?.getAttribute("aria-label")).toBe(
        copy.nav.primary,
      );
      expect(root.querySelector('a[href="/privacy"]')?.textContent).toBe(copy.footer.privacy);
      expect(root.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe(
        copy.platform.tabs,
      );
      const structured = JSON.parse(
        root.querySelector('script[type="application/ld+json"]')!.textContent!,
      );
      expect(structured.inLanguage).toBe(locale === "kg" ? "ky" : locale);
      expect(structured.offers.map((offer: { price: string }) => Number(offer.price))).toEqual(
        getPlanCatalogEntries().map((plan) => plan.monthlyPriceKgs),
      );
      expect(root.querySelectorAll("article[data-plan]")).toHaveLength(3);
      const metadata = await generateMetadata();
      expect(metadata.title).toBe(copy.meta.title);
      expect(metadata.description).toBe(copy.meta.description);
      expect(metadata.openGraph?.locale).toBe({ ru: "ru_KG", kg: "ky_KG", en: "en_US" }[locale]);
      for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))
        expect(root.querySelector(link.getAttribute("href")!)).toBeTruthy();
    },
  );
  it("keeps the authenticated root destination unchanged", async () => {
    state.token = { role: "ADMIN" };
    await expect(RootPage()).rejects.toThrow("redirect:/dashboard");
    state.token = null;
    expect((await RootPage()).type).toBe(MarketingLanding);
  });
  it("has the same complete copy shape for all locales, including lists and legacy ky", () => {
    const shape = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(shape)
        : value && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, shape(child)]))
          : typeof value;
    expect(shape(getMarketingCopy("kg"))).toEqual(shape(getMarketingCopy("ru")));
    expect(shape(getMarketingCopy("en"))).toEqual(shape(getMarketingCopy("ru")));
    expect(getMarketingCopy("ky")).toBe(getMarketingCopy("kg"));
  });
});

describe("marketing feature tabs", () => {
  it.each(["ru", "kg", "en"] as const)(
    "supports arrows, wrap, Home/End and valid panel references in %s",
    (locale) => {
      const copy = getMarketingCopy(locale);
      render(
        <FeatureShowcase
          featureCopy={copy.features}
          previewCopy={copy.preview}
          previewData={getMarketingPreviewData(locale)}
          label={copy.platform.tabs}
        />,
      );
      const tabs = screen.getAllByRole("tab");
      const active = () => tabs.find((tab) => tab.getAttribute("aria-selected") === "true")!;
      fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
      expect(active()).toBe(tabs[5]);
      expect(document.activeElement).toBe(tabs[5]);
      fireEvent.keyDown(tabs[5], { key: "Home" });
      expect(active()).toBe(tabs[0]);
      fireEvent.keyDown(tabs[0], { key: "End" });
      expect(active()).toBe(tabs[5]);
      fireEvent.keyDown(tabs[5], { key: "ArrowRight" });
      expect(active()).toBe(tabs[0]);
      fireEvent.click(tabs[2]);
      expect(screen.getByRole("tabpanel").textContent).toContain(copy.features.products.title);
      expect(tabs.filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
      for (const tab of tabs)
        expect(document.getElementById(tab.getAttribute("aria-controls")!)).toBe(
          screen.getByRole("tabpanel"),
        );
      expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabs[2].id);
    },
  );
});

describe("marketing preview hydration", () => {
  it("preserves server-formatted Kyrgyz amounts when the browser cannot format that locale", () => {
    const copy = getMarketingCopy("kg");
    const previewData = getMarketingPreviewData("kg");
    const browserFormatter = vi.spyOn(Intl, "NumberFormat").mockImplementation(() => {
      throw new Error("Browser ICU does not support the server locale");
    });
    try {
      render(
        <FeatureShowcase
          featureCopy={copy.features}
          previewCopy={copy.preview}
          previewData={previewData}
          label={copy.platform.tabs}
        />,
      );
      fireEvent.click(screen.getAllByRole("tab").at(-1)!);
      expect(screen.getByRole("tabpanel").textContent).toContain(previewData.revenue);
      expect(screen.getByRole("tabpanel").textContent).toContain(previewData.average);
      expect(browserFormatter).not.toHaveBeenCalled();
    } finally {
      browserFormatter.mockRestore();
    }
  });
});

describe("marketing mobile menu", () => {
  beforeEach(() => {
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal("innerWidth", 390);
  });
  it("restores background and trigger focus after Escape", () => {
    const copy = getMarketingCopy("ru");
    render(
      <main>
        <MarketingNav copy={copy.nav} />
        <section id="platform">content</section>
      </main>,
    );
    const trigger = screen.getByRole("button", { name: copy.nav.open });
    expect(trigger.getAttribute("aria-controls")).toBeNull();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: copy.nav.mobile });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.body.style.position).toBe("fixed");
    expect(document.getElementById("platform")!.inert).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.position).toBe("");
    expect(document.getElementById("platform")!.inert).not.toBe(true);
  });
  it("focuses the selected section and restores scrolling after a mobile anchor", () => {
    const copy = getMarketingCopy("en");
    render(
      <main>
        <MarketingNav copy={copy.nav} />
        <section id="pricing">plans</section>
      </main>,
    );
    fireEvent.click(screen.getByRole("button", { name: copy.nav.open }));
    const navigation = within(screen.getByRole("dialog")).getByRole("navigation", {
      name: copy.nav.mobile,
    });
    fireEvent.click(within(navigation).getByRole("link", { name: copy.nav.pricing }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(document.getElementById("pricing"));
    expect(location.hash).toBe("#pricing");
    expect(document.body.style.position).toBe("");
  });
  it("returns focus to the visible brand link when a desktop resize removes the mobile trigger", () => {
    const copy = getMarketingCopy("en");
    render(
      <main>
        <MarketingNav copy={copy.nav} />
        <section>content</section>
      </main>,
    );
    fireEvent.click(screen.getByRole("button", { name: copy.nav.open }));
    vi.stubGlobal("innerWidth", 1280);
    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: copy.nav.home }));
    expect(document.body.style.position).toBe("");
  });
});

describe("marketing language recovery", () => {
  it.each(["http", "network"])(
    "shows and recovers from a %s failure without a false refresh",
    async (mode) => {
      let failed = true;
      state.fetch.mockImplementation(async () => {
        if (failed && mode === "network") throw new TypeError("network");
        return { ok: !failed };
      });
      render(
        <NextIntlClientProvider locale="ru" messages={{ common: ru.common, errors: ru.errors }}>
          <MarketingLocaleSwitcher />
        </NextIntlClientProvider>,
      );
      const select = screen.getByRole("combobox", { name: ru.common.language });
      await act(async () => fireEvent.change(select, { target: { value: "kg" } }));
      expect(screen.getByRole("alert").textContent).toBe(ru.errors.genericMessage);
      expect(state.refresh).not.toHaveBeenCalled();
      expect(select.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
      failed = false;
      await act(async () => fireEvent.change(select, { target: { value: "kg" } }));
      expect(state.refresh).toHaveBeenCalledOnce();
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );
});
