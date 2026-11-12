// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";

const state = vi.hoisted(() => ({
  path: "/ru", id: "G-TEST123456" as string | null, locale: "ru" as "ru" | "kg" | "en",
  choice: null as "granted" | "denied" | null, blocked: false,
  metaId: null as string | null, metaChoice: null as "granted" | "denied" | null,
  synchronize: vi.fn(), track: vi.fn(), write: vi.fn(),
  synchronizeMeta: vi.fn(), writeMeta: vi.fn(),
}));
vi.mock("@/lib/metaMarketing", () => ({
  metaMeasurementId: () => state.metaId,
  readMetaConsent: () => state.metaChoice,
  synchronizeMetaMeasurement: state.synchronizeMeta,
  writeMetaConsent: (choice: "granted" | "denied") => {
    state.writeMeta(choice); state.metaChoice = choice;
    window.dispatchEvent(new Event("bazaar:meta-consent"));
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => {
  const copy = { ru, kg, en }[state.locale].analyticsConsent;
  return copy[key as keyof typeof copy];
} }));
vi.mock("@/lib/marketingAnalytics", () => ({
  analyticsPrivacyOptOut: () => state.blocked,
  marketingMeasurementId: () => state.id,
  publicMarketingPage: (path: string) => ["/ru", "/privacy"].includes(path) ? { path } : null,
  readAnalyticsConsent: () => state.choice,
  synchronizeMarketingAnalytics: state.synchronize,
  trackMarketingEvent: state.track,
  interceptPrivateMarketingLink: vi.fn(),
  writeAnalyticsConsent: (choice: "granted" | "denied", advertising: "granted" | "denied") => {
    state.write(choice, advertising); state.choice = choice;
    window.dispatchEvent(new Event("bazaar:analytics-consent"));
  },
}));
import { MarketingAnalytics } from "@/components/analytics/marketing-analytics";

beforeEach(() => {
  vi.clearAllMocks(); state.path = "/ru"; state.id = "G-TEST123456";
  state.locale = "ru"; state.choice = null; state.blocked = false;
  state.metaId = null; state.metaChoice = null;
  window.history.replaceState({}, "", "/ru");
});
afterEach(cleanup);

describe("human-readable optional analytics choice", () => {
  it.each(["ru", "kg", "en"] as const)("offers an independent Meta choice with Google disabled in %s", locale => {
    state.locale = locale; state.id = null; state.metaId = "1635457884748007";
    const copy = { ru, kg, en }[locale].analyticsConsent;
    render(<MarketingAnalytics />);
    expect(screen.getByRole("complementary", { name: copy.metaTitle })).toBeTruthy();
    expect(screen.queryByRole("button", { name: copy.allowAdvertising })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: copy.metaAllow }));
    expect(state.writeMeta).toHaveBeenCalledExactlyOnceWith("granted");
    expect(state.write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: copy.settings }));
    fireEvent.click(screen.getByRole("button", { name: copy.metaDecline }));
    expect(state.writeMeta).toHaveBeenLastCalledWith("denied");
  });

  it("does not reuse or overwrite an existing Google permission when choosing Meta", () => {
    state.choice = "granted"; state.metaId = "1635457884748007";
    render(<><input aria-label="Unsubmitted value" defaultValue="Synthetic form value" /><MarketingAnalytics /></>);
    expect(screen.getByText(ru.analyticsConsent.metaDescription)).toBeTruthy();
    expect(state.writeMeta).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: ru.analyticsConsent.metaDecline }));
    expect(state.writeMeta).toHaveBeenCalledWith("denied"); expect(state.write).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Unsubmitted value") as HTMLInputElement).value).toBe("Synthetic form value");
  });
  it.each(["ru", "kg", "en"] as const)("offers refusal and a reversible choice in %s", locale => {
    state.locale = locale;
    const copy = { ru, kg, en }[locale].analyticsConsent;
    render(<MarketingAnalytics />);
    expect(screen.getByRole("complementary", { name: copy.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: copy.privacy }).getAttribute("href")).toBe("/privacy");
    expect(state.write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: copy.decline }));
    expect(state.write).toHaveBeenCalledWith("denied", "denied");
    fireEvent.click(screen.getByRole("button", { name: copy.settings }));
    fireEvent.click(screen.getByRole("button", { name: copy.allow }));
    expect(state.write).toHaveBeenLastCalledWith("granted", "denied");
    fireEvent.click(screen.getByRole("button", { name: copy.settings }));
    fireEvent.click(screen.getByRole("button", { name: copy.allowAdvertising }));
    expect(state.write).toHaveBeenLastCalledWith("granted", "granted");
    fireEvent.click(screen.getByRole("button", { name: copy.settings }));
    fireEvent.click(screen.getByRole("button", { name: copy.allow }));
    expect(state.write).toHaveBeenLastCalledWith("granted", "denied");
  });

  it("does not expand an existing statistics permission without a separate selection", () => {
    state.choice = "granted";
    render(<><input aria-label="Unsubmitted value" defaultValue="Synthetic form value" /><MarketingAnalytics /></>);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(state.write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: ru.analyticsConsent.settings }));
    expect(screen.getByText(ru.analyticsConsent.advertisingDescription)).toBeTruthy();
    expect(state.write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: ru.analyticsConsent.allowAdvertising }));
    expect(state.write).toHaveBeenCalledExactlyOnceWith("granted", "granted");
    expect((screen.getByLabelText("Unsubmitted value") as HTMLInputElement).value).toBe("Synthetic form value");
  });

  it("does not prompt for an unconfigured stream or inside the private app", () => {
    state.id = null;
    const page = render(<MarketingAnalytics />);
    expect(page.container.textContent).toBe("");
    state.id = "G-TEST123456"; state.path = "/products";
    page.rerender(<MarketingAnalytics />);
    expect(page.container.textContent).toBe("");
  });

  it("honours the browser signal without offering a conflicting allow button", () => {
    state.path = "/privacy"; state.blocked = true;
    render(<MarketingAnalytics />);
    expect(screen.getByText(ru.analyticsConsent.browserChoice)).toBeTruthy();
    expect(screen.queryByRole("button", { name: ru.analyticsConsent.allow })).toBeNull();
    expect(screen.queryByRole("button", { name: ru.analyticsConsent.allowAdvertising })).toBeNull();
  });

  it("resynchronizes a restored public document without remounting or clearing form state", () => {
    render(<><input aria-label="Unsubmitted value" defaultValue="Synthetic form value" /><MarketingAnalytics /></>);
    state.synchronize.mockClear();
    act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    expect(state.synchronize).toHaveBeenCalledExactlyOnceWith("/ru");
    expect((screen.getByLabelText("Unsubmitted value") as HTMLInputElement).value).toBe("Synthetic form value");
  });

  it("measures only the actual BAZAAR WhatsApp link without passing its URL", () => {
    render(<MarketingAnalytics />);
    const anchor = document.createElement("a");
    anchor.href = "https://wa.me/996709911300?text=private";
    anchor.innerHTML = "<span>Contact</span>";
    anchor.addEventListener("click", event => event.preventDefault());
    document.body.appendChild(anchor);
    act(() => fireEvent.click(anchor.firstChild!));
    expect(state.track).toHaveBeenCalledExactlyOnceWith("contact_whatsapp_click");
    anchor.href = "https://example.invalid/";
    act(() => fireEvent.click(anchor));
    expect(state.track).toHaveBeenCalledTimes(1);
    anchor.remove();
  });
});
