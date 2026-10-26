// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ru from "../../messages/ru.json";

const state = vi.hoisted(() => ({ fetch: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push, refresh: state.refresh }) }));
import { LoyaltyCard } from "@/app/loyalty/card/card-view";

const view = {
  member: { id: "synthetic-member", displayName: null, email: "qa@example.invalid" },
  store: { id: "synthetic-store", name: "Магазин для проверки" },
  rules: { memberDiscountPercent: 5, earnPercent: 5, maxSpendPercent: 50, pointValueKgs: 1 },
  rulesText: "Тестовые условия", balancePoints: 125, availablePoints: 100, history: [],
};
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
let cardStatus = 200;
const mount = () => render(<NextIntlClientProvider locale="ru" messages={{ loyalty: ru.loyalty, common: ru.common, errors: ru.errors, catalogPublic: ru.catalogPublic }}><LoyaltyCard view={view} /></NextIntlClientProvider>);
const clickQr = () => fireEvent.click(screen.getByRole("button", { name: ru.loyalty.showQr }));
beforeEach(() => {
  vi.clearAllMocks(); cardStatus = 200;
  vi.stubGlobal("fetch", state.fetch);
  state.fetch.mockImplementation(async (url: string) => response(url.endsWith("/consent") ? [] : view, url.endsWith("/card") ? cardStatus : 200));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("loyalty card recovery", () => {
  it("shows a QR failure and allows a successful retry without dropping confirmed points", async () => {
    let fail = true;
    state.fetch.mockImplementation(async (url: string) => url.endsWith("/qr")
      ? fail ? response({}, 503) : response({ qrDataUrl: "data:image/png;base64,AAAA", expiresAt: new Date(Date.now() + 120000).toISOString() })
      : response([]));
    mount(); clickQr();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("100")).toBeTruthy();
    fail = false; clickQr();
    expect(await screen.findByRole("img", { name: ru.loyalty.qrAlt })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it.each(["not-a-date", new Date(0).toISOString()])("rejects an unusable QR expiry %s", async (expiresAt) => {
    state.fetch.mockImplementation(async (url: string) => response(url.endsWith("/qr") ? { qrDataUrl: "data:image/png;base64,AAAA", expiresAt } : []));
    mount(); clickQr();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
  it.each(["http", "network"])("does not claim sign-out when %s fails, then retries", async (mode) => {
    let fail = true;
    state.fetch.mockImplementation(async (url: string) => {
      if (!url.endsWith("/signout")) return response([]);
      if (fail && mode === "network") throw new TypeError("network");
      return response({}, fail ? 503 : 200);
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: ru.loyalty.signOut }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(state.push).not.toHaveBeenCalled();
    fail = false;
    await act(async () => fireEvent.click(screen.getByRole("button", { name: ru.loyalty.signOut })));
    expect(state.push).toHaveBeenCalledWith("/");
  });
  it("retains the last confirmed card on refresh failure and supports retry", async () => {
    cardStatus = 503;
    mount();
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("100")).toBeTruthy();
    cardStatus = 200;
    await act(async () => fireEvent.click(screen.getByRole("button", { name: ru.common.tryAgain })));
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("hides the card and QR after the server rejects an expired session", async () => {
    cardStatus = 401;
    mount();
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(await screen.findByText(ru.loyalty.noSession)).toBeTruthy();
    expect(screen.queryByText("100")).toBeNull();
    expect(screen.queryByRole("button", { name: ru.loyalty.showQr })).toBeNull();
  });
  it("reports consent loading failure and recovers without approving anything", async () => {
    let fail = true;
    state.fetch.mockImplementation(async () => response([], fail ? 503 : 200));
    mount();
    expect(await screen.findByText(ru.loyalty.consentRefreshFailed)).toBeTruthy();
    fail = false;
    await act(async () => fireEvent.click(screen.getByRole("button", { name: ru.common.tryAgain })));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(state.fetch.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
  });
  it("ignores an older card response arriving after a newer confirmed refresh", async () => {
    const pending: Array<(value: unknown) => void> = [];
    state.fetch.mockImplementation((url: string) => url.endsWith("/card") ? new Promise((resolve) => pending.push(resolve)) : Promise.resolve(response([])));
    mount();
    await act(async () => window.dispatchEvent(new Event("focus")));
    await act(async () => window.dispatchEvent(new Event("focus")));
    await act(async () => pending[1](response({ ...view, availablePoints: 80 })));
    expect(screen.getByText("80")).toBeTruthy();
    await act(async () => pending[0](response({ ...view, availablePoints: 110 })));
    expect(screen.getByText("80")).toBeTruthy();
    expect(screen.queryByText("110")).toBeNull();
  });
});
