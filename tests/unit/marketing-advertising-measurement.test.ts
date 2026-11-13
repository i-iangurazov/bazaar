// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const id = "G-TEST123456";
const consentKey = "bazaar_marketing_consent_v2";
const clickKey = "bazaar_google_click_v1";
type AnalyticsWindow = Window & { dataLayer?: unknown[][]; gtag?: (...args: unknown[]) => void };
const commands = () => ((window as AnalyticsWindow).dataLayer ?? []).map(command => Array.from(command));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_GA4_MEASUREMENT_ID", id);
  vi.stubEnv("NEXT_PUBLIC_GA4_ENABLED", "true");
  localStorage.clear(); sessionStorage.clear();
  document.head.innerHTML = ""; document.body.innerHTML = "";
  for (const cookie of document.cookie.split(";"))
    document.cookie = `${cookie.trim().split("=")[0]}=; Max-Age=0; Path=/`;
  window.history.replaceState({}, "", "/ru?gclid=TeSter-123&gad_source=1&email=private@example.invalid#secret");
  Object.defineProperty(navigator, "globalPrivacyControl", { value: false, configurable: true });
  Object.defineProperty(navigator, "doNotTrack", { value: "0", configurable: true });
  delete (window as AnalyticsWindow).dataLayer;
  delete (window as AnalyticsWindow).gtag;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("separate advertising measurement permission", () => {
  it("keeps legacy permission statistics-only and never stores a click before a separate grant", async () => {
    localStorage.setItem("bazaar_analytics_consent_v1", JSON.stringify({ version: 1, choice: "granted", at: Date.now() }));
    const analytics = await import("@/lib/marketingAnalytics");
    expect(analytics.readAdvertisingConsent()).toBe("denied");
    analytics.synchronizeMarketingAnalytics("/ru");
    expect(commands()[0]).toEqual(["consent", "default", {
      analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
    }]);
    expect(sessionStorage.getItem(clickKey)).toBeNull();
    expect(JSON.stringify(commands())).not.toMatch(/TeSter|gad_source|private@example|secret/);
  });

  it("carries only explicitly consented click parameters from landing through signup and its success event", async () => {
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.synchronizeMarketingAnalytics("/ru");
    expect(commands()).toEqual([]);
    expect(sessionStorage.getItem(clickKey)).toBeNull();
    analytics.writeAnalyticsConsent("granted", "granted");
    analytics.synchronizeMarketingAnalytics("/ru");
    expect(commands()[0]).toEqual(["consent", "default", {
      analytics_storage: "granted", ad_storage: "granted", ad_user_data: "granted", ad_personalization: "denied",
    }]);
    expect(commands().find(command => command[0] === "config")?.[2]).toEqual({
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
    });
    expect(commands().find(command => command[1] === "page_view")?.[2]).toMatchObject({
      page_location: "https://www.bazaar.kg/ru?gclid=TeSter-123&gad_source=1", page_referrer: "",
    });
    window.history.pushState({}, "", "/signup?name=private-name&phone=996700000000#password");
    analytics.synchronizeMarketingAnalytics("/signup");
    analytics.trackMarketingEvent("sign_up");
    expect(commands().find(command => command[1] === "sign_up")?.[2]).toEqual({
      send_to: id, page_location: "https://www.bazaar.kg/signup?gclid=TeSter-123&gad_source=1",
      page_referrer: "", page_title: "BAZAAR", method: "email",
    });
    expect(commands().filter(command => command[0] === "config")).toHaveLength(1);
    expect(commands().filter(command => command[1] === "page_view")).toHaveLength(2);
    expect(JSON.stringify(commands())).not.toMatch(/private-name|996700000000|password|private@example|secret|user_id/);
    expect(document.cookie).not.toContain("bazaar_google_click");
  });

  it("changes purpose without reconfiguring or generating a second manual view, then removes Ads data on downgrade", async () => {
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/ru");
    analytics.writeAnalyticsConsent("granted", "granted");
    analytics.synchronizeMarketingAnalytics("/ru");
    document.cookie = "_gcl_aw=synthetic-click; Path=/";
    document.cookie = "_ga=statistics; Path=/";
    document.cookie = "bazaar_acquisition=source; Path=/";
    document.cookie = "auth-session=private; Path=/";
    localStorage.setItem("_gcl_ls", "synthetic-click");
    expect(sessionStorage.getItem(clickKey)).toContain("TeSter-123");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/ru");
    analytics.trackMarketingEvent("contact_whatsapp_click");
    expect(commands().filter(command => command[0] === "config")).toHaveLength(1);
    expect(commands().filter(command => command[1] === "page_view")).toHaveLength(1);
    expect(commands().filter(command => command[0] === "consent").at(-1)).toEqual([
      "consent", "update", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" },
    ]);
    expect(commands().filter(command => command[1] === "contact_whatsapp_click").at(-1)?.[2]).toMatchObject({
      page_location: "https://www.bazaar.kg/ru",
    });
    expect(sessionStorage.getItem(clickKey)).toBeNull();
    expect(localStorage.getItem("_gcl_ls")).toBeNull();
    expect(document.cookie).not.toContain("_gcl_aw=");
    expect(document.cookie).toContain("_ga=statistics");
    expect(document.cookie).toContain("bazaar_acquisition=source");
    expect(document.cookie).toContain("auth-session=private");
    window.history.pushState({}, "", "/signup");
    analytics.writeAnalyticsConsent("granted", "granted");
    analytics.synchronizeMarketingAnalytics("/signup");
    expect(commands().filter(command => command[1] === "page_view").at(-1)?.[2]).toMatchObject({
      page_location: "https://www.bazaar.kg/signup",
    }); // Re-allowing cannot revive the discarded session click.
  });

  it.each(["doNotTrack", "globalPrivacyControl"])("clears the bridge and disables the SDK when %s overrides both choices", async signal => {
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted", "granted");
    analytics.synchronizeMarketingAnalytics("/ru");
    const eventCount = commands().filter(command => command[0] === "event").length;
    Object.defineProperty(navigator, signal, { value: signal === "doNotTrack" ? "1" : true, configurable: true });
    analytics.synchronizeMarketingAnalytics("/ru");
    analytics.trackMarketingEvent("sign_up");
    expect(sessionStorage.getItem(clickKey)).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect(commands().filter(command => command[0] === "event")).toHaveLength(eventCount);
    expect(commands().filter(command => command[0] === "consent").at(-1)?.[2]).toEqual({
      analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
    });
  });

  it("does not load or persist click parameters from private/token documents even with both permissions", async () => {
    window.history.replaceState({}, "", "/register-business/private-token?gclid=TeSter-123&phone=996700000000");
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted", "granted");
    analytics.synchronizeMarketingAnalytics(window.location.pathname);
    analytics.trackMarketingEvent("sign_up");
    expect(commands()).toEqual([]);
    expect(sessionStorage.getItem(clickKey)).toBeNull();
  });

  it("persists both purposes atomically, rejects expired/invalid choices, and never falls back to an older grant", async () => {
    const analytics = await import("@/lib/marketingAnalytics");
    localStorage.setItem("bazaar_analytics_consent_v1", JSON.stringify({ version: 1, choice: "granted", at: Date.now() }));
    analytics.writeAnalyticsConsent("granted", "granted");
    expect(JSON.parse(localStorage.getItem(consentKey)!)).toMatchObject({ version: 2, analytics: "granted", advertising: "granted" });
    expect(localStorage.getItem("bazaar_analytics_consent_v1")).toBeNull();
    for (const saved of [
      { version: 2, analytics: "denied", advertising: "granted", at: Date.now() },
      { version: 2, analytics: "granted", advertising: "granted", at: Date.now() + 1000 },
      { version: 2, analytics: "granted", advertising: "granted", at: Date.now() - 180 * 86400000 },
    ]) {
      localStorage.setItem("bazaar_analytics_consent_v1", JSON.stringify({ version: 1, choice: "granted", at: Date.now() }));
      localStorage.setItem(consentKey, JSON.stringify(saved));
      expect(analytics.readAnalyticsConsent()).toBeNull();
      expect(analytics.readAdvertisingConsent()).toBeNull();
    }
  });

  it("respects withdrawal with read-only storage or a throwing third-party SDK and restores analytics-only safely", async () => {
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted", "granted");
    analytics.synchronizeMarketingAnalytics("/ru");
    const gtag = (window as AnalyticsWindow).gtag;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    (window as AnalyticsWindow).gtag = () => { throw new Error("SDK blocked"); };
    expect(() => analytics.writeAnalyticsConsent("denied")).not.toThrow();
    expect(analytics.readAnalyticsConsent()).toBe("denied");
    expect(analytics.readAdvertisingConsent()).toBe("denied");
    expect(document.querySelector("script")).toBeNull();
    (window as AnalyticsWindow).gtag = gtag;
    window.history.pushState({}, "", "/signup");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/signup");
    expect(commands().filter(command => command[0] === "consent").at(-1)?.[2]).toEqual({
      analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
    });
    expect(commands().filter(command => command[0] === "config")).toHaveLength(1);
  });
});

describe("bounded public click bridge", () => {
  it("keeps identifier case and full documented GCLID length without copying arbitrary query values", async () => {
    const { marketingClickQuery } = await import("@/lib/marketingClickIds");
    const gclid = "TeSter-123-ABCDEFGHIJKLMNOPQRSTUVWXYZ-abcdefghijklmnopqrstuvwxyz-0123456789-AaBbCcDdEeFfGgHhIiJjKkLl";
    expect(gclid).toHaveLength(100);
    expect(marketingClickQuery(new URLSearchParams({ gclid, gad_source: "1", email: "private@example.invalid", utm_term: "private" })))
      .toBe(`gclid=${gclid}&gad_source=1`);
    expect(sessionStorage.getItem(clickKey)).not.toMatch(/private|utm_term|email/);
  });

  it.each(["gclid=a&gclid=b", "gclid=private%40example.invalid", "gclid=https%3A%2F%2Fexample.invalid", "gclid=" + "x".repeat(101), "gbraid=" + "x".repeat(257), "gad_source=private", "gad_source=1234", "wbraid=%0Asecret"])(
    "rejects malformed or overlong click data: %s", async search => {
      const { marketingClickQuery } = await import("@/lib/marketingClickIds");
      expect(marketingClickQuery(new URLSearchParams(search))).toBe("");
      expect(sessionStorage.getItem(clickKey)).toBeNull();
    },
  );

  it("does not renew the 30-minute bridge during signup/return navigation and replaces rather than mixes a newer click", async () => {
    const { marketingClickQuery } = await import("@/lib/marketingClickIds");
    const at = Date.now();
    expect(marketingClickQuery(new URLSearchParams("gclid=First-Click&gad_source=1"), at)).toBe("gclid=First-Click&gad_source=1");
    expect(marketingClickQuery(new URLSearchParams(), at + 15 * 60000)).toBe("gclid=First-Click&gad_source=1");
    expect(marketingClickQuery(new URLSearchParams("gclid=First-Click&gad_source=1"), at + 29 * 60000)).toBe("gclid=First-Click&gad_source=1");
    expect(JSON.parse(sessionStorage.getItem(clickKey)!).at).toBe(at);
    expect(marketingClickQuery(new URLSearchParams(), at + 30 * 60000)).toBe("");
    expect(marketingClickQuery(new URLSearchParams("gclid=First-Click&gad_source=1"), at + 31 * 60000)).toBe("");
    expect(marketingClickQuery(new URLSearchParams("gbraid=New_Braid&gad_source=2"), at + 32 * 60000)).toBe("gbraid=New_Braid&gad_source=2");
    expect(sessionStorage.getItem(clickKey)).not.toContain("First-Click");
  });

  it("survives a public-document reload, rejects tampered storage, and uses an in-memory bridge if storage is unavailable", async () => {
    let bridge = await import("@/lib/marketingClickIds");
    bridge.marketingClickQuery(new URLSearchParams("wbraid=Same_Tab"));
    vi.resetModules();
    bridge = await import("@/lib/marketingClickIds");
    expect(bridge.marketingClickQuery(new URLSearchParams())).toBe("wbraid=Same_Tab");
    sessionStorage.setItem(clickKey, JSON.stringify({ version: 1, at: Date.now(), query: "gclid=Valid&email=private" }));
    expect(bridge.marketingClickQuery(new URLSearchParams())).toBe("");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    bridge.marketingClickQuery(new URLSearchParams("gclid=InMemory"));
    // A failed write must not revive the readable, older storage record.
    expect(bridge.marketingClickQuery(new URLSearchParams())).toBe("gclid=InMemory");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    expect(bridge.marketingClickQuery(new URLSearchParams())).toBe("gclid=InMemory");
    bridge.clearMarketingClickIds();
    expect(bridge.marketingClickQuery(new URLSearchParams())).toBe("");
  });

  it("cannot revive a withdrawn click when storage reads succeed but removing the old record fails", async () => {
    const bridge = await import("@/lib/marketingClickIds");
    bridge.marketingClickQuery(new URLSearchParams("gclid=TeSter-123&gad_source=1"));
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("Read only", "SecurityError"); });
    bridge.clearMarketingClickIds();
    expect(sessionStorage.getItem(clickKey)).toContain("TeSter-123"); // Physical removal failed.
    expect(bridge.marketingClickQuery(new URLSearchParams())).toBe("");
    expect(bridge.marketingClickQuery(new URLSearchParams("gclid=TeSter-123&gad_source=1"))).toBe("");
    expect(bridge.marketingClickQuery(new URLSearchParams("gclid=Actually-New"))).toBe("gclid=Actually-New");
  });
});
