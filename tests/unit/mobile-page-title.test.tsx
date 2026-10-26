// @vitest-environment jsdom
import React from "react";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { render, cleanup } from "@testing-library/react";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMobilePageTitle } from "@/lib/mobile-page-title";
import { MobileTopBar } from "@/components/mobile-app-shell";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";
vi.mock("@/components/guidance/page-tips-button", () => ({ PageTipsButton: () => null }));
vi.mock("@/components/pwa-install-button", () => ({ PwaInstallButton: () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dev/scanner-test",
  useSearchParams: () => new URLSearchParams(),
}));
afterEach(cleanup);
const dictionaries = { ru, kg, en };
const pages = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? pages(join(directory, entry.name))
      : entry.name === "page.tsx"
        ? [join(directory, entry.name)]
        : [],
  );
const applicationPaths = pages("src/app/(app)").map(
  (path) =>
    path
      .replace("src/app/(app)", "")
      .replace("/page.tsx", "")
      .replace(/\[[^\]]+\]/g, "example") || "/",
);
describe.each(["ru", "kg", "en"] as const)("mobile context titles in %s", (locale) => {
  const messages = dictionaries[locale];
  const translate = {
    nav: createTranslator({ locale, messages: { nav: messages.nav }, namespace: "nav" }),
    breadcrumbs: createTranslator({
      locale,
      messages: { breadcrumbs: messages.breadcrumbs },
      namespace: "breadcrumbs",
    }),
    scanner: createTranslator({
      locale,
      messages: { scannerTest: messages.scannerTest },
      namespace: "scannerTest",
    }),
  };
  it("names every current authenticated page source without repeating the brand", () => {
    for (const path of applicationPaths) {
      const title = getMobilePageTitle(path, translate);
      expect(title, path).not.toBe("");
      expect(title, path).not.toBe(messages.nav.brand);
    }
  });
  it("uses the scanner diagnostic title and preserves established section names", () => {
    expect(getMobilePageTitle("/dev/scanner-test", translate)).toBe(messages.scannerTest.title);
    expect(getMobilePageTitle("/inventory/counts/example", translate)).toBe(messages.nav.inventory);
    expect(getMobilePageTitle("/settings/printing", translate)).toBe(messages.nav.printing);
    expect(getMobilePageTitle("/purchase-orders/example", translate)).toBe(
      messages.nav.purchaseOrders,
    );
  });
  it("renders one brand and no invented context for an unknown route", () => {
    const title = getMobilePageTitle("/unmapped-screen", translate);
    expect(title).toBe("");
    const { container } = render(
      <MobileTopBar
        pageTitle={title}
        profileLabel="Profile"
        moreLabel="More"
        onOpenMore={() => {}}
      />,
    );
    expect(container.textContent?.match(/BAZAAR/g)).toHaveLength(1);
    expect(container.querySelectorAll("header p")).toHaveLength(1);
  });
  it("labels the diagnostic breadcrumbs in the selected language", () => {
    const { container } = render(
      <NextIntlClientProvider
        locale={locale}
        messages={{
          nav: messages.nav,
          breadcrumbs: messages.breadcrumbs,
          scannerTest: messages.scannerTest,
          pos: { entry: messages.pos.entry },
        }}
        timeZone="Asia/Bishkek"
      >
        <PageBreadcrumbs />
      </NextIntlClientProvider>,
    );
    expect(container.textContent).toContain(messages.nav.diagnostics);
    expect(container.textContent).toContain(messages.scannerTest.title);
    expect(container.textContent).not.toContain("dev");
  });
});
it("matches route boundaries rather than unrelated prefix lookalikes", () => {
  const translate = {
    nav: (key: string) => key,
    breadcrumbs: (key: string) => key,
    scanner: (key: string) => key,
  };
  expect(getMobilePageTitle("/products-archive", translate)).toBe("");
  expect(getMobilePageTitle("/settings/printing-extra", translate)).toBe("settings");
});
