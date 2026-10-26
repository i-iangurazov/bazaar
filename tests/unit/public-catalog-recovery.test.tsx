// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ru from "../../messages/ru.json";

const state = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/components/language-switcher", () => ({ LanguageSwitcher: () => null }));
import { PublicCatalogPage } from "@/components/catalog/public-catalog-page";

const product = {
  id: "synthetic-product", name: "Чай для проверки", category: "Напитки", priceKgs: 150,
  quotedUnitPriceKgs: 150, compareAtPriceKgs: null, hasDiscount: false,
  discountPercentage: null, imageUrl: null, isBundle: false, variants: [],
};
const catalog = {
  slug: "synthetic-catalog", storeId: "synthetic-store", title: "Магазин для проверки",
  storeName: "Магазин", currencyCode: "KGS", accentColor: "#ffffff", fontFamily: "Inter",
  headerStyle: "STANDARD", logoUrl: null, categories: [{ key: "напитки", name: "Напитки", count: 1 }],
  pagination: { page: 1, pageSize: 24, total: 1, totalPages: 1, hasMore: false },
  products: [product],
};
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const mount = () => render(<NextIntlClientProvider locale="ru" messages={{ loyalty: ru.loyalty, common: ru.common, errors: ru.errors, catalogPublic: ru.catalogPublic }}><PublicCatalogPage slug={catalog.slug} /></NextIntlClientProvider>);

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", state.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("public catalog recovery and merchant branding", () => {
  it("actually requests the failed catalog again from the retry button", async () => {
    state.fetch.mockResolvedValueOnce(response({ message: "genericMessage" }, 503)).mockResolvedValue(response(catalog));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: ru.catalogPublic.retry }));
    await waitFor(() => expect(state.fetch.mock.calls.filter(([url]) => String(url).startsWith("/api/public/catalog/"))).toHaveLength(2));
    expect(await screen.findByRole("heading", { name: catalog.title })).toBeTruthy();
  });
  it("does not label a transient network failure as a missing catalog", async () => {
    state.fetch.mockRejectedValue(new TypeError("network unavailable"));
    mount();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(ru.catalogPublic.notFoundTitle)).toBeNull();
    expect(screen.queryByText("network unavailable")).toBeNull();
  });
  it("keeps genuine not-found handling separate from a temporary service failure", async () => {
    state.fetch.mockResolvedValue(response({ message: "catalogNotFound" }, 404));
    mount();
    expect(await screen.findByRole("heading", { name: ru.catalogPublic.notFoundTitle })).toBeTruthy();
  });
  it("announces category expansion and retains the selected quantity when collapsing", async () => {
    state.fetch.mockResolvedValue(response(catalog));
    mount();
    const category = await screen.findByRole("button", { name: /Напитки/ });
    expect(category.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(category.getAttribute("aria-controls")!);
    expect(panel?.contains(screen.getByText(product.name))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Увеличить количество: Чай для проверки" }));
    fireEvent.click(category);
    expect(category.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(category);
    expect((screen.getByRole("textbox", { name: /Количество/ }) as HTMLInputElement).value).toBe("1");
  });
  it("preserves a white merchant accent while giving the action a readable foreground", async () => {
    state.fetch.mockResolvedValue(response(catalog));
    mount();
    const add = await screen.findByRole("button", { name: "Увеличить количество: Чай для проверки" });
    expect(add.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(add.style.color).toBe("rgb(0, 0, 0)");
  });
  it("keeps checkout details and the same idempotency key after a failed submission", async () => {
    const submissions: Array<{ body: string; key: string }> = [];
    state.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith("/checkout")) {
        submissions.push({ body: String(options?.body), key: (options?.headers as Record<string, string>)["Idempotency-Key"] });
        return submissions.length === 1 ? response({}, 503) : response({ order: { id: "synthetic-order", number: "QA-001" } });
      }
      return url.startsWith("/api/public/") ? response(catalog) : response({}, 401);
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Увеличить количество: Чай для проверки" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Корзина/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: ru.catalogPublic.checkoutOpen }));
    fireEvent.change(screen.getByLabelText(ru.catalogPublic.checkoutName), { target: { value: "Учебный покупатель" } });
    fireEvent.change(screen.getByLabelText(ru.catalogPublic.checkoutEmail), { target: { value: "consumer@example.invalid" } });
    fireEvent.change(screen.getByLabelText(ru.catalogPublic.checkoutPhone), { target: { value: "+996555123456" } });
    fireEvent.click(screen.getByRole("button", { name: ru.catalogPublic.checkoutSubmit }));
    await screen.findByRole("alert");
    expect((screen.getByLabelText(ru.catalogPublic.checkoutName) as HTMLInputElement).value).toBe("Учебный покупатель");
    fireEvent.click(screen.getByRole("button", { name: ru.catalogPublic.checkoutSubmit }));
    expect(await screen.findByText(ru.catalogPublic.successTitle)).toBeTruthy();
    expect(submissions).toHaveLength(2);
    expect(submissions[0].key).toBeTruthy();
    expect(submissions[1]).toEqual(submissions[0]);
  });
});
