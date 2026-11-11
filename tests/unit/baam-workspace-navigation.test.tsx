// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import BaamPage from "@/app/(app)/baam/page";
import { baamPathname, baamWorkspaceReturnHref, nativeBaamWorkspaceHref } from "@/lib/baam/workspaceNavigation";

const native = vi.hoisted(() => ({ ios: true, search: "" }));
vi.mock("@/lib/native/platform", () => ({ isIOS: () => native.ios }));
vi.mock("next/navigation", () => ({ usePathname: () => "/baam", useSearchParams: () => new URLSearchParams(native.search) }));
vi.mock("next/link", () => ({ default: ({ href, replace, prefetch: _prefetch, ...props }: ComponentProps<"a"> & { href: string; replace?: boolean; prefetch?: boolean }) =>
  <a {...props} href={href} data-replaces-route={replace ? "true" : undefined} /> }));
vi.mock("@/components/baam-assistant", () => ({ BaamAssistant: () => <div data-testid="existing-baam-assistant">Existing history/composer surface</div> }));

const translations = { en, ru, kg };
beforeEach(() => { native.ios = true; native.search = ""; });
afterEach(cleanup);

describe("native BAAM workspace navigation", () => {
  it("carries only a valid explicit store hint and an internal return destination", () => {
    const href = nativeBaamWorkspaceHref({ pathname: "/kg/inventory", search: "?storeId=store_1&page=3", hash: "#product" });
    const url = new URL(href, "https://bazaar.invalid");
    expect(url.pathname).toBe("/baam");
    expect(url.searchParams.get("storeId")).toBe("store_1");
    expect(url.searchParams.get("returnTo")).toBe("/kg/inventory?storeId=store_1&page=3#product");
    const invalid = new URL(nativeBaamWorkspaceHref({ pathname: "/products", search: "?storeId=%2Funsafe", hash: "" }), "https://bazaar.invalid");
    expect(invalid.searchParams.has("storeId")).toBe(false);
  });

  it.each([undefined, "", "https://outside.invalid", "//outside.invalid", "/\\outside.invalid", "/baam", "/kg/baam/?returnTo=other"])(
    "uses a safe dashboard fallback for unsupported return target %s", (value) => {
      expect(baamWorkspaceReturnHref(value)).toBe("/dashboard");
    },
  );

  it.each(["/baam", "/ru/baam/", "/en/baam?storeId=a", "/ky/baam#question"])("recognizes the existing localized workspace %s", (pathname) => {
    expect(baamPathname(pathname)).toBe("/baam");
  });

  it.each(["en", "ru", "kg"] as const)("shows a localized iOS back action to the original filtered page in %s", (locale) => {
    native.search = new URLSearchParams({ returnTo: "/inventory?storeId=store_1&page=3#product" }).toString();
    render(<NextIntlClientProvider locale={locale} messages={translations[locale]}><BaamPage /></NextIntlClientProvider>);
    const back = screen.getByRole("link", { name: translations[locale].common.back });
    expect(back.getAttribute("href")).toBe("/inventory?storeId=store_1&page=3#product");
    expect(back.getAttribute("data-replaces-route")).toBe("true");
    expect(screen.getByTestId("existing-baam-assistant")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps direct iOS entries safe when there is no previous app page", () => {
    native.search = "returnTo=https%3A%2F%2Foutside.invalid";
    render(<NextIntlClientProvider locale="en" messages={en}><BaamPage /></NextIntlClientProvider>);
    expect(screen.getByRole("link", { name: en.common.back }).getAttribute("href")).toBe("/dashboard");
  });

  it("preserves the existing web full page without the native back action", () => {
    native.ios = false;
    render(<NextIntlClientProvider locale="en" messages={en}><BaamPage /></NextIntlClientProvider>);
    expect(screen.queryByRole("link", { name: en.common.back })).toBeNull();
    expect(screen.getByTestId("existing-baam-assistant")).toBeTruthy();
  });
});
