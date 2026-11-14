// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/native/platform", () => ({ isNativeApp: () => false }));

import { publicMarketingPage } from "@/lib/marketingPrivacy";
import { marketingSolutionPath, solutionPages } from "@/lib/marketingSolutions";

const ids = [null, ...solutionPages.map((page) => page.id)];
const paths = ["ru", "kg", "en"].flatMap((locale) => ids.map((id) => marketingSolutionPath(locale, id)));
type AnalyticsWindow = Window & { dataLayer?: unknown[][]; gtag?: (...args: unknown[]) => void };
type Pixel = ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void };
type PixelWindow = Window & { fbq?: Pixel; _fbq?: Pixel };
const commands = () => ((window as AnalyticsWindow).dataLayer ?? []).map((command) => Array.from(command));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_GA4_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_GA4_MEASUREMENT_ID", "G-TEST123456");
  vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "1635457884748007");
  localStorage.clear();
  sessionStorage.clear();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  Object.defineProperty(document, "referrer", { configurable: true, value: "" });
  Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "0" });
  window.history.replaceState({}, "", "/ru/solutions/inventory-management");
  delete (window as AnalyticsWindow).dataLayer;
  delete (window as AnalyticsWindow).gtag;
  delete (window as PixelWindow).fbq;
  delete (window as PixelWindow)._fbq;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("exact solution measurement allowlist", () => {
  it.each(paths)("allows the canonical public page %s using a controlled title", (path) => {
    document.title = "private@example.invalid";
    expect(publicMarketingPage(path)).toEqual({
      path,
      title: expect.stringMatching(/^BAZAAR — /),
    });
    expect(publicMarketingPage(path)?.title).not.toContain("private@example");
  });

  it.each([
    "/ky/solutions",
    "/ky/solutions/inventory-management",
    "/fr/solutions/inventory-management",
    "/ru/solutions/missing",
    "/ru/solutions/products",
    "/ru/solutions/inventory-management/private",
    "/ru/solutions/inventory-management?email=private@example.invalid",
    "/ru/solutions/inventory-management#private",
    "/ru/solutions/inventory-management/",
    "/ru/products",
    "/products",
    "/c/private-store",
  ])("keeps %s outside public measurement", (path) => {
    expect(publicMarketingPage(path)).toBeNull();
  });

  it("does not load GA or Meta from a solution page before explicit permissions", async () => {
    const analytics = await import("@/lib/marketingAnalytics");
    const meta = await import("@/lib/metaMarketing");
    analytics.synchronizeMarketingAnalytics(window.location.pathname);
    meta.synchronizeMetaMeasurement(window.location.pathname);
    expect(commands()).toEqual([]);
    expect(document.querySelector("script")).toBeNull();
    expect((window as PixelWindow).fbq).toBeUndefined();
  });

  it("preserves the consented Google click bridge from the new page through signup without leaking other query data", async () => {
    window.history.replaceState({}, "", "/ru/solutions/inventory-management?gclid=Synthetic-Click-123&email=private@example.invalid#private");
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted", "granted");
    analytics.synchronizeMarketingAnalytics(window.location.pathname);
    expect(commands().find((command) => command[1] === "page_view")?.[2]).toMatchObject({
      page_location: "https://www.bazaar.kg/ru/solutions/inventory-management?gclid=Synthetic-Click-123",
      page_referrer: "",
    });
    window.history.pushState({}, "", "/signup?name=private-name#password");
    analytics.synchronizeMarketingAnalytics("/signup");
    analytics.trackMarketingEvent("sign_up");
    expect(commands().find((command) => command[1] === "sign_up")?.[2]).toMatchObject({
      page_location: "https://www.bazaar.kg/signup?gclid=Synthetic-Click-123",
      method: "email",
    });
    expect(JSON.stringify(commands())).not.toMatch(/private@example|private-name|password|#private/);
  });

  it("measures the new page and the real signup separately after Meta consent, not a page visit as a registration", async () => {
    vi.useFakeTimers();
    const meta = await import("@/lib/metaMarketing");
    expect(meta.safeMetaContext()).toBe(true);
    meta.writeMetaConsent("granted");
    meta.synchronizeMetaMeasurement(window.location.pathname);
    const send = vi.fn();
    (window as PixelWindow).fbq!.callMethod = send;
    document.getElementById("bazaar-meta-measurement")!.dispatchEvent(new Event("load"));
    expect(send.mock.calls.filter((call) => call[2] === "PageView")).toHaveLength(1);
    await meta.trackMetaSignupBeforeNavigation();
    expect(send.mock.calls.filter((call) => call[2] === "CompleteRegistration")).toHaveLength(0);
    window.history.pushState({}, "", "/signup");
    meta.synchronizeMetaMeasurement("/signup");
    const sent = meta.trackMetaSignupBeforeNavigation();
    await vi.advanceTimersByTimeAsync(150);
    await sent;
    expect(send.mock.calls.filter((call) => call[2] === "PageView")).toHaveLength(2);
    expect(send.mock.calls.filter((call) => call[2] === "CompleteRegistration")).toHaveLength(1);
  });

  it("continues to reject personal URL parameters and unreviewed hashes for Meta on a known solution", async () => {
    window.history.replaceState({}, "", "/ru/solutions/inventory-management?email=private@example.invalid");
    const meta = await import("@/lib/metaMarketing");
    expect(meta.safeMetaContext()).toBe(false);
    window.history.replaceState({}, "", "/ru/solutions/inventory-management#private");
    expect(meta.safeMetaContext()).toBe(false);
  });

  it("honours browser privacy opt-out for both providers on a new public solution", async () => {
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: true });
    const analytics = await import("@/lib/marketingAnalytics");
    const meta = await import("@/lib/metaMarketing");
    analytics.writeAnalyticsConsent("granted", "granted");
    meta.writeMetaConsent("granted");
    analytics.synchronizeMarketingAnalytics(window.location.pathname);
    meta.synchronizeMetaMeasurement(window.location.pathname);
    expect(document.querySelector("script")).toBeNull();
    expect(commands()).toEqual([]);
  });
});
