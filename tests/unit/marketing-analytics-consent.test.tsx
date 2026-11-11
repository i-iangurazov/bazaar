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
  synchronize: vi.fn(), track: vi.fn(), write: vi.fn(),
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
  writeAnalyticsConsent: (choice: "granted" | "denied") => {
    state.write(choice); state.choice = choice;
    window.dispatchEvent(new Event("bazaar:analytics-consent"));
  },
}));
import { MarketingAnalytics } from "@/components/analytics/marketing-analytics";

beforeEach(() => {
  vi.clearAllMocks(); state.path = "/ru"; state.id = "G-TEST123456";
  state.locale = "ru"; state.choice = null; state.blocked = false;
  window.history.replaceState({}, "", "/ru");
});
afterEach(cleanup);

describe("human-readable optional analytics choice", () => {
  it.each(["ru", "kg", "en"] as const)("offers refusal and a reversible choice in %s", locale => {
    state.locale = locale;
    const copy = { ru, kg, en }[locale].analyticsConsent;
    render(<MarketingAnalytics />);
    expect(screen.getByRole("complementary", { name: copy.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: copy.privacy }).getAttribute("href")).toBe("/privacy");
    expect(state.write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: copy.decline }));
    expect(state.write).toHaveBeenCalledWith("denied");
    fireEvent.click(screen.getByRole("button", { name: copy.settings }));
    fireEvent.click(screen.getByRole("button", { name: copy.allow }));
    expect(state.write).toHaveBeenLastCalledWith("granted");
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
