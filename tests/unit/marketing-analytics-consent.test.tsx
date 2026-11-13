// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";

type Consent = "granted" | "denied";
const state = vi.hoisted(() => ({
  path: "/ru", id: "G-TEST123456" as string | null, locale: "ru" as "ru" | "kg" | "en",
  choice: null as Consent | null, advertisingChoice: null as Consent | null, blocked: false,
  metaId: null as string | null, metaChoice: null as Consent | null,
  synchronize: vi.fn(), track: vi.fn(), write: vi.fn(),
  synchronizeMeta: vi.fn(), writeMeta: vi.fn(),
}));
vi.mock("@/lib/metaMarketing", () => ({
  metaMeasurementId: () => state.metaId,
  readMetaConsent: () => state.metaChoice,
  synchronizeMetaMeasurement: state.synchronizeMeta,
  writeMetaConsent: (choice: Consent) => {
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
  readAdvertisingConsent: () => state.advertisingChoice,
  synchronizeMarketingAnalytics: state.synchronize,
  trackMarketingEvent: state.track,
  interceptPrivateMarketingLink: vi.fn(),
  writeAnalyticsConsent: (choice: Consent, advertising: Consent) => {
    state.write(choice, advertising); state.choice = choice;
    state.advertisingChoice = choice === "granted" ? advertising : "denied";
    window.dispatchEvent(new Event("bazaar:analytics-consent"));
  },
}));
import { MarketingAnalytics } from "@/components/analytics/marketing-analytics";

const copy = ru.analyticsConsent;
const button = (name: string) => screen.getByRole("button", { name });
const toggle = (name: string) => screen.getByRole("switch", { name });
const checked = (name: string) => toggle(name).getAttribute("aria-checked") === "true";
async function click(name: string) {
  await act(async () => { fireEvent.click(button(name)); });
}
async function change(name: string) {
  await act(async () => { fireEvent.click(toggle(name)); });
}
async function escape() {
  await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
}
function savedBoth() {
  state.choice = "granted"; state.advertisingChoice = "denied";
  state.metaId = "1635457884748007"; state.metaChoice = "denied";
}

beforeEach(() => {
  vi.resetAllMocks(); state.path = "/ru"; state.id = "G-TEST123456";
  state.locale = "ru"; state.choice = null; state.advertisingChoice = null; state.blocked = false;
  state.metaId = null; state.metaChoice = null;
  window.history.replaceState({}, "", "/ru");
});
afterEach(cleanup);

describe("compact optional measurement choices", () => {
  it.each(["ru", "kg", "en"] as const)("offers clear choices and settings in %s", async locale => {
    state.locale = locale; state.metaId = "1635457884748007";
    const text = { ru, kg, en }[locale].analyticsConsent;
    render(<MarketingAnalytics />);
    expect(screen.getByRole("complementary", { name: text.bannerTitle })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(text.summary)).toBeTruthy();
    expect(button(text.acceptAll)).toBeTruthy(); expect(button(text.rejectAll)).toBeTruthy();
    expect(button(text.dismiss)).toBeTruthy();
    expect(state.write).not.toHaveBeenCalled(); expect(state.writeMeta).not.toHaveBeenCalled();
    await click(text.customize);
    expect(screen.getByRole("dialog", { name: text.settingsTitle })).toBeTruthy();
    expect(screen.getByRole("link", { name: text.privacy }).getAttribute("href")).toBe("/privacy");
    expect(checked(text.googleStatistics)).toBe(false);
    expect(checked(text.googleAdvertising)).toBe(false);
    expect(checked(text.metaAdvertising)).toBe(false);
    expect((toggle(text.googleAdvertising) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(["ru", "kg", "en"] as const)("supports Meta alone without inventing a Google grant in %s", async locale => {
    state.locale = locale; state.id = null; state.metaId = "1635457884748007";
    const text = { ru, kg, en }[locale].analyticsConsent;
    render(<MarketingAnalytics />);
    expect(screen.getByText(text.metaSummary)).toBeTruthy();
    await click(text.acceptAll);
    expect(state.writeMeta).toHaveBeenCalledExactlyOnceWith("granted");
    expect(state.write).not.toHaveBeenCalled();
    await click(text.settings);
    expect(screen.queryByRole("switch", { name: text.googleStatistics })).toBeNull();
    await change(text.metaAdvertising); await click(text.save);
    expect(state.writeMeta).toHaveBeenLastCalledWith("denied");
    expect(state.write).not.toHaveBeenCalled();
  });

  it.each(["granted", "denied"] as const)("applies %s to both configured providers before synchronization", async next => {
    state.metaId = "1635457884748007";
    const snapshots: Array<[Consent | null, Consent | null, Consent | null]> = [];
    state.synchronize.mockImplementation(() => snapshots.push([state.choice, state.advertisingChoice, state.metaChoice]));
    render(<MarketingAnalytics />);
    state.synchronize.mockClear(); state.synchronizeMeta.mockClear(); snapshots.length = 0;
    await click(next === "granted" ? copy.acceptAll : copy.rejectAll);
    expect(state.write).toHaveBeenCalledExactlyOnceWith(next, next);
    expect(state.writeMeta).toHaveBeenCalledExactlyOnceWith(next);
    expect(state.synchronize).toHaveBeenCalledExactlyOnceWith("/ru");
    expect(state.synchronizeMeta).toHaveBeenCalledExactlyOnceWith("/ru");
    expect(snapshots).toEqual([[next, next, next]]);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(button(copy.settings)).toBeTruthy();
  });

  it("writes only Google for a Google-only installation", async () => {
    render(<MarketingAnalytics />);
    expect(screen.getByText(copy.googleSummary)).toBeTruthy();
    await click(copy.rejectAll);
    expect(state.write).toHaveBeenCalledExactlyOnceWith("denied", "denied");
    expect(state.writeMeta).not.toHaveBeenCalled();
  });

  it.each(["close", "escape"] as const)("dismisses using %s without granting or refreshing any permission", async method => {
    state.metaId = "1635457884748007";
    render(<><input aria-label="Unsubmitted value" defaultValue="Synthetic form value" /><MarketingAnalytics /></>);
    if (method === "close") await click(copy.dismiss); else await escape();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(state.write).not.toHaveBeenCalled(); expect(state.writeMeta).not.toHaveBeenCalled();
    expect(state.choice).toBeNull(); expect(state.metaChoice).toBeNull();
    await click(copy.settings);
    expect(checked(copy.googleStatistics)).toBe(false); expect(checked(copy.metaAdvertising)).toBe(false);
    expect((screen.getByLabelText("Unsubmitted value") as HTMLInputElement).value).toBe("Synthetic form value");
  });

  it("keeps an old statistics-only permission unchanged when saving only a Meta decision", async () => {
    state.choice = "granted"; state.advertisingChoice = "denied";
    state.metaId = "1635457884748007";
    render(<><input aria-label="Unsubmitted value" defaultValue="Synthetic form value" /><MarketingAnalytics /></>);
    expect(state.write).not.toHaveBeenCalled(); expect(state.writeMeta).not.toHaveBeenCalled();
    await click(copy.customize);
    expect(checked(copy.googleStatistics)).toBe(true);
    expect(checked(copy.googleAdvertising)).toBe(false); expect(checked(copy.metaAdvertising)).toBe(false);
    await change(copy.metaAdvertising);
    expect(state.writeMeta).not.toHaveBeenCalled(); expect(state.write).not.toHaveBeenCalled();
    await click(copy.save);
    expect(state.write).not.toHaveBeenCalled();
    expect(state.writeMeta).toHaveBeenCalledExactlyOnceWith("granted");
    expect((screen.getByLabelText("Unsubmitted value") as HTMLInputElement).value).toBe("Synthetic form value");
  });

  it("opens saved choices without automatically expanding advertising permissions", async () => {
    savedBoth(); render(<MarketingAnalytics />);
    expect(screen.queryByRole("complementary")).toBeNull();
    await click(copy.settings);
    expect(checked(copy.googleStatistics)).toBe(true);
    expect(checked(copy.googleAdvertising)).toBe(false); expect(checked(copy.metaAdvertising)).toBe(false);
    await click(copy.save);
    expect(state.write).not.toHaveBeenCalled(); expect(state.writeMeta).not.toHaveBeenCalled();
  });

  it("requires statistics for Google advertising while keeping Meta independent", async () => {
    state.metaId = "1635457884748007";
    render(<MarketingAnalytics />); await click(copy.customize);
    expect((toggle(copy.googleAdvertising) as HTMLButtonElement).disabled).toBe(true);
    await change(copy.googleStatistics); await change(copy.googleAdvertising); await change(copy.metaAdvertising);
    expect(checked(copy.googleAdvertising)).toBe(true); expect(checked(copy.metaAdvertising)).toBe(true);
    await change(copy.googleStatistics);
    expect(checked(copy.googleAdvertising)).toBe(false);
    expect((toggle(copy.googleAdvertising) as HTMLButtonElement).disabled).toBe(true);
    expect(checked(copy.metaAdvertising)).toBe(true);
    await click(copy.save);
    expect(state.write).toHaveBeenCalledExactlyOnceWith("denied", "denied");
    expect(state.writeMeta).toHaveBeenCalledExactlyOnceWith("granted");
  });

  it.each(["cancel", "close", "escape"] as const)("discards draft changes through %s", async method => {
    savedBoth(); render(<MarketingAnalytics />); await click(copy.settings);
    await change(copy.googleStatistics); await change(copy.metaAdvertising);
    if (method === "escape") await escape();
    else await click(method === "cancel" ? copy.cancel : copy.closeSettings);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(state.write).not.toHaveBeenCalled(); expect(state.writeMeta).not.toHaveBeenCalled();
    await click(copy.settings);
    expect(checked(copy.googleStatistics)).toBe(true);
    expect(checked(copy.googleAdvertising)).toBe(false); expect(checked(copy.metaAdvertising)).toBe(false);
  });

  it("traps keyboard focus only in requested settings and returns it to the opener", async () => {
    const user = userEvent.setup();
    render(<><a href="/signup">Start free</a><MarketingAnalytics /></>);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(button(copy.customize));
    const dialog = screen.getByRole("dialog", { name: copy.settingsTitle });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.click(toggle(copy.googleStatistics));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(button(copy.closeSettings));
    await user.tab();
    expect(document.activeElement).toBe(toggle(copy.googleStatistics));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button(copy.customize));
    expect(state.write).not.toHaveBeenCalled(); expect(state.writeMeta).not.toHaveBeenCalled();
  });

  it("closes requested settings when following the privacy link without saving draft choices", async () => {
    state.metaId = "1635457884748007";
    render(<MarketingAnalytics />); await click(copy.customize);
    await change(copy.googleStatistics); await change(copy.metaAdvertising);
    const privacy = screen.getByRole("link", { name: copy.privacy });
    expect(privacy.getAttribute("href")).toBe("/privacy");
    // Keep this unit test in the same document while exercising the real link handler.
    privacy.addEventListener("click", event => event.preventDefault(), { once: true });
    await act(async () => { fireEvent.click(privacy); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(state.write).not.toHaveBeenCalled(); expect(state.writeMeta).not.toHaveBeenCalled();
    await click(copy.customize);
    expect(checked(copy.googleStatistics)).toBe(false); expect(checked(copy.metaAdvertising)).toBe(false);
  });

  it("retains unsaved settings when another tab changes unrelated storage", async () => {
    savedBoth(); render(<MarketingAnalytics />); await click(copy.settings);
    await change(copy.googleAdvertising); await change(copy.metaAdvertising);
    await act(async () => window.dispatchEvent(new StorageEvent("storage", {
      key: "bazaar_theme", oldValue: "light", newValue: "dark",
    })));
    expect(checked(copy.googleStatistics)).toBe(true);
    expect(checked(copy.googleAdvertising)).toBe(true); expect(checked(copy.metaAdvertising)).toBe(true);
    expect(state.write).not.toHaveBeenCalled(); expect(state.writeMeta).not.toHaveBeenCalled();
    await click(copy.save);
    expect(state.write).toHaveBeenCalledExactlyOnceWith("granted", "granted");
    expect(state.writeMeta).toHaveBeenCalledExactlyOnceWith("granted");
  });

  it.each(["storage", "pageshow"] as const)("replaces a stale open draft after an external %s update", async type => {
    savedBoth(); render(<MarketingAnalytics />); await click(copy.settings);
    await change(copy.googleAdvertising); await change(copy.metaAdvertising);
    state.choice = "denied"; state.advertisingChoice = "denied"; state.metaChoice = "denied";
    await act(async () => window.dispatchEvent(type === "storage"
      ? new StorageEvent("storage") : new PageTransitionEvent("pageshow", { persisted: true })));
    expect(checked(copy.googleStatistics)).toBe(false);
    expect(checked(copy.googleAdvertising)).toBe(false); expect(checked(copy.metaAdvertising)).toBe(false);
    await click(copy.save);
    expect(state.write).not.toHaveBeenCalled(); expect(state.writeMeta).not.toHaveBeenCalled();
  });

  it("does not prompt for an unconfigured stream or inside the private app", () => {
    state.id = null;
    const page = render(<MarketingAnalytics />);
    expect(page.container.textContent).toBe("");
    state.id = "G-TEST123456"; state.path = "/products";
    page.rerender(<MarketingAnalytics />);
    expect(page.container.textContent).toBe("");
  });

  it("honours the browser opt-out without offering a conflicting allow button", () => {
    state.path = "/privacy"; state.blocked = true; state.metaId = "1635457884748007";
    render(<MarketingAnalytics />);
    expect(screen.getByText(copy.browserChoice)).toBeTruthy();
    expect(screen.queryByRole("button", { name: copy.acceptAll })).toBeNull();
    expect(screen.queryByRole("button", { name: copy.customize })).toBeNull();
    expect(state.write).not.toHaveBeenCalled(); expect(state.writeMeta).not.toHaveBeenCalled();
  });

  it("removes open settings if a browser opt-out becomes active", async () => {
    state.metaId = "1635457884748007";
    render(<MarketingAnalytics />); await click(copy.customize);
    await change(copy.googleStatistics); await change(copy.metaAdvertising);
    state.blocked = true;
    await act(async () => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: copy.acceptAll })).toBeNull();
    expect(state.write).not.toHaveBeenCalled(); expect(state.writeMeta).not.toHaveBeenCalled();
  });

  it("resynchronizes a restored public document without clearing form state", async () => {
    render(<><input aria-label="Unsubmitted value" defaultValue="Synthetic form value" /><MarketingAnalytics /></>);
    state.synchronize.mockClear();
    await act(async () => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
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
