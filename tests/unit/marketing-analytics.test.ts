// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

type AnalyticsWindow = Window & { dataLayer?: unknown[][]; gtag?: (...args: unknown[]) => void };
const measurementId = "G-TEST123456";
const commands = () => ((window as AnalyticsWindow).dataLayer ?? []).map(command => Array.from(command));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_GA4_MEASUREMENT_ID", measurementId);
  vi.stubEnv("NEXT_PUBLIC_GA4_ENABLED", "true");
  localStorage.clear();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  for (const cookie of document.cookie.split(";"))
    document.cookie = `${cookie.trim().split("=")[0]}=; Max-Age=0; Path=/`;
  Object.defineProperty(navigator, "globalPrivacyControl", { value: false, configurable: true });
  Object.defineProperty(navigator, "doNotTrack", { value: "0", configurable: true });
  window.history.replaceState({}, "", "/");
  delete (window as AnalyticsWindow).dataLayer;
  delete (window as AnalyticsWindow).gtag;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("optional marketing analytics", () => {
  it.each(["disabled", "invalid"])("preserves existing GA cookies when the SDK was never configured: %s", async (mode) => {
    if (mode === "disabled") vi.stubEnv("NEXT_PUBLIC_GA4_ENABLED", "false");
    else vi.stubEnv("NEXT_PUBLIC_GA4_MEASUREMENT_ID", "invalid");
    document.cookie = "_ga=previous-setup; Path=/";
    document.cookie = "_ga_OTHER=another-stream; Path=/";
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.synchronizeMarketingAnalytics("/");
    analytics.writeAnalyticsConsent("denied");
    expect(document.cookie).toContain("_ga=previous-setup");
    expect(document.cookie).toContain("_ga_OTHER=another-stream");
    expect(document.querySelector("script")).toBeNull();
    expect(commands()).toEqual([]);
  });

  it("still disables an initialized ID after the configuration gate is switched off", async () => {
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/");
    document.cookie = "_ga_TEST123456=previous-visit; Path=/";
    vi.stubEnv("NEXT_PUBLIC_GA4_ENABLED", "false");
    analytics.writeAnalyticsConsent("denied");
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`]).toBe(true);
    expect(document.cookie).not.toContain("_ga_TEST123456=");
    expect(document.querySelector("script")).toBeNull();
  });

  it("sets controlled campaign overrides after consent and before configuration without exposing the raw URL", async () => {
    window.history.replaceState({}, "", "/ru?utm_source=instagram&utm_medium=organic_social&utm_campaign=profile&utm_content=bio&email=private@example.invalid&gclid=secret-click#private-fragment");
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.synchronizeMarketingAnalytics("/ru");
    expect(commands()).toEqual([]);
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/ru");
    const queued = commands();
    const overrides = queued.findIndex((command) => command[0] === "set");
    const config = queued.findIndex((command) => command[0] === "config");
    const page = queued.findIndex((command) => command[1] === "page_view");
    expect(queued[overrides]?.[1]).toMatchObject({
      campaign_source: "instagram", campaign_medium: "organic_social",
      campaign_name: "profile", campaign_content: "bio",
      page_location: "https://www.bazaar.kg/ru", page_referrer: "",
    });
    expect(overrides).toBeGreaterThanOrEqual(0);
    expect(config).toBeGreaterThan(overrides);
    expect(page).toBeGreaterThan(config);
    window.history.replaceState({}, "", "/signup");
    analytics.synchronizeMarketingAnalytics("/signup");
    analytics.trackMarketingEvent("sign_up");
    expect(commands().filter((command) => command[0] === "config")).toHaveLength(1);
    expect(JSON.stringify(commands())).not.toMatch(/private@example|secret-click|private-fragment|utm_source=/);
  });

  it("does not export arbitrary campaign labels after consenting", async () => {
    window.history.replaceState({}, "", "/en?utm_source=instagram&utm_medium=paid_social&utm_campaign=kg_store_launch_202611&utm_content=ad01_ru&utm_term=996700000000");
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/en");
    expect(JSON.stringify(commands())).not.toMatch(/campaign_source|campaign_medium|campaign_name|campaign_content|campaign_term|996700000000/);
  });

  it("updates sanitized global engagement context before public route views without reconfiguring on signup or exposing private routes", async () => {
    window.history.replaceState({}, "", "/ru?utm_source=instagram&utm_medium=organic_social&utm_campaign=profile&utm_content=bio&email=private@example.invalid#private");
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/ru");
    const initial = commands();
    const globalContext = initial.findIndex(command => command[0] === "set");
    const config = initial.findIndex(command => command[0] === "config");
    expect(initial[globalContext][1]).toMatchObject({
      send_page_view: false, page_location: "https://www.bazaar.kg/ru",
      page_referrer: "", page_title: "BAZAAR",
    });
    expect(globalContext).toBeLessThan(config);
    expect(initial[config][2]).toEqual({
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
    });
    for (const field of ["page_location", "page_referrer", "page_title"])
      expect(initial[config][2]).not.toHaveProperty(field);
    const initialLength = commands().length;
    window.history.pushState({}, "", "/signup?phone=996700000000#private-form");
    analytics.synchronizeMarketingAnalytics("/signup");
    expect(commands().slice(initialLength)).toEqual([
      ["set", { send_page_view: false, page_location: "https://www.bazaar.kg/signup", page_referrer: "", page_title: "BAZAAR — Sign up" }],
      ["event", "page_view", { send_to: measurementId, page_location: "https://www.bazaar.kg/signup", page_referrer: "", page_title: "BAZAAR — Sign up" }],
    ]);
    analytics.synchronizeMarketingAnalytics("/signup");
    expect(commands().filter(command => command[0] === "config")).toHaveLength(1);
    expect(commands().filter(command => command[1] === "page_view")).toHaveLength(2);
    const beforePrivate = commands().length;
    window.history.pushState({}, "", "/register-business/private-registration-token?email=private@example.invalid");
    analytics.synchronizeMarketingAnalytics(window.location.pathname);
    analytics.trackMarketingEvent("sign_up");
    expect(commands()).toHaveLength(beforePrivate);
    expect(JSON.stringify(commands())).not.toMatch(/private@example|996700000000|private-form|private-registration-token|utm_source=/);
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`]).toBe(true);
  });

  it("does not activate from a copied stream ID before the readiness gate is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_GA4_ENABLED", "false");
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/");
    expect(document.querySelector("script")).toBeNull();
    expect(commands()).toEqual([]);
  });
  it.each(["", "G-bad", "G-TEST123456?email=private@example.invalid"])(
    "does not load Google for an absent or invalid configuration %s", async id => {
      vi.stubEnv("NEXT_PUBLIC_GA4_MEASUREMENT_ID", id);
      const analytics = await import("@/lib/marketingAnalytics");
      analytics.writeAnalyticsConsent("granted");
      analytics.synchronizeMarketingAnalytics("/");
      expect(document.querySelector("script")).toBeNull();
      expect(commands()).toEqual([]);
    },
  );

  it("sends nothing before consent or after declining, including consent pings", async () => {
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.synchronizeMarketingAnalytics("/");
    analytics.trackMarketingEvent("contact_whatsapp_click");
    analytics.writeAnalyticsConsent("denied");
    analytics.synchronizeMarketingAnalytics("/");
    expect(document.querySelector("script")).toBeNull();
    expect(commands()).toEqual([]);
  });

  it.each(["globalPrivacyControl", "doNotTrack"])("respects %s over stored permission", async signal => {
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    Object.defineProperty(navigator, signal, { value: signal === "doNotTrack" ? "1" : true, configurable: true });
    analytics.synchronizeMarketingAnalytics("/");
    analytics.trackMarketingEvent("contact_whatsapp_click");
    expect(document.querySelector("script")).toBeNull();
    expect(commands()).toEqual([]);
  });

  it("loads only the configured tag and sends manual public views without query, hash or referrer", async () => {
    const analytics = await import("@/lib/marketingAnalytics");
    window.history.replaceState({}, "", "/ru?email=private@example.invalid&phone=996709911300#secret");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/ru");
    analytics.synchronizeMarketingAnalytics("/ru"); // React effect replay is not another visit.
    analytics.trackMarketingEvent("contact_whatsapp_click");
    expect(document.querySelector("script")?.src).toBe(`https://www.googletagmanager.com/gtag/js?id=${measurementId}`);
    const views = commands().filter(command => command[1] === "page_view");
    expect(views).toHaveLength(1);
    expect(views[0][2]).toMatchObject({ page_location: "https://www.bazaar.kg/ru", page_referrer: "" });
    expect(commands().find(command => command[0] === "config")?.[2]).toMatchObject({
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
    });
    const queued = commands();
    expect(queued[0]).toEqual(["consent", "default", {
      analytics_storage: "granted", ad_storage: "denied",
      ad_user_data: "denied", ad_personalization: "denied",
    }]);
    expect(queued.find(command => command[0] === "set")?.[1]).toMatchObject({ send_page_view: false });
    expect(queued.findIndex(command => command[0] === "set"))
      .toBeLessThan(queued.findIndex(command => command[0] === "config"));
    // Initial consent is already known: no post-config grant reconfiguration.
    expect(queued.filter(command => command[0] === "consent")).toHaveLength(1);
    expect(JSON.stringify(commands())).not.toMatch(/private@example|996709911300|#secret|\?email=/);
  });

  it("waits for SDK event processing before disabling analytics and replacing the public document", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/signup?email=private@example.invalid#private");
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/signup");
    const spa = vi.fn();
    const hard = vi.fn(() => {
      expect((window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`]).toBe(true);
    });
    const pending = analytics.trackSignupBeforeNavigation().then(() => {
      analytics.replaceAfterMarketingSuccess("/register-business/private-token", spa, hard);
    });
    const events = commands().filter(command => command[1] === "sign_up");
    expect(events).toHaveLength(1);
    const payload = events[0][2] as { event_callback: () => void; event_timeout: number };
    expect(payload).toMatchObject({
      send_to: measurementId, event_timeout: 1000, method: "email",
      page_location: "https://www.bazaar.kg/signup", page_referrer: "",
    });
    expect(JSON.stringify(commands())).not.toMatch(/private@example|private-token|#private/);
    await vi.advanceTimersByTimeAsync(999);
    expect(hard).not.toHaveBeenCalled();
    expect(document.querySelector("script")).not.toBeNull();
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`]).toBe(false);
    payload.event_callback();
    await pending;
    expect(hard).toHaveBeenCalledExactlyOnceWith(window.location.origin + "/register-business/private-token");
    expect(spa).not.toHaveBeenCalled();
    expect(document.querySelector("script")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    payload.event_callback(); // A late/repeated SDK acknowledgement cannot navigate twice.
    await vi.advanceTimersByTimeAsync(1000);
    expect(hard).toHaveBeenCalledTimes(1);
  });

  it("continues at the independent deadline when a blocked SDK never invokes its callback", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/signup");
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/signup");
    const finished = vi.fn();
    const pending = analytics.trackSignupBeforeNavigation().then(finished);
    await vi.advanceTimersByTimeAsync(999);
    expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(finished).toHaveBeenCalledTimes(1);
    expect(commands().filter(command => command[1] === "sign_up")).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never lets a third-party dispatch exception block successful registration", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/signup");
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/signup");
    (window as AnalyticsWindow).gtag = () => { throw new Error("Synthetic blocked SDK"); };
    const timersBefore = vi.getTimerCount();
    await analytics.trackSignupBeforeNavigation();
    expect(vi.getTimerCount()).toBe(timersBefore);
  });

  it.each(["declined", "dnt", "gpc", "disabled", "uninitialized", "missing SDK", "private"])(
    "does not delay or send a signup event when measurement is unavailable: %s", async scenario => {
      vi.useFakeTimers();
      window.history.replaceState({}, "", "/signup");
      const analytics = await import("@/lib/marketingAnalytics");
      analytics.writeAnalyticsConsent("granted");
      if (scenario !== "uninitialized") analytics.synchronizeMarketingAnalytics("/signup");
      if (scenario === "declined") analytics.writeAnalyticsConsent("denied");
      if (scenario === "dnt") Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
      if (scenario === "gpc") Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
      if (scenario === "disabled") vi.stubEnv("NEXT_PUBLIC_GA4_ENABLED", "false");
      if (scenario === "missing SDK") delete (window as AnalyticsWindow).gtag;
      if (scenario === "private") {
        window.history.replaceState({}, "", "/register-business/private-token");
        analytics.synchronizeMarketingAnalytics(window.location.pathname);
      }
      const before = commands().length;
      const timersBefore = vi.getTimerCount();
      await analytics.trackSignupBeforeNavigation();
      expect(commands()).toHaveLength(before);
      expect(vi.getTimerCount()).toBe(timersBefore);
    },
  );

  it("never initializes on private or secret-token pages", async () => {
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    for (const path of ["/products", "/billing", "/c/private-store", "/register-business/secret-token"]) {
      window.history.replaceState({}, "", path);
      analytics.synchronizeMarketingAnalytics(path);
      analytics.trackMarketingEvent("sign_up");
      expect(analytics.publicMarketingPage(path)).toBeNull();
    }
    expect(document.querySelector("script")).toBeNull();
    expect(commands()).toEqual([]);
  });

  it("disables analytics on token and private app pages and never measures business success there", async () => {
    window.history.replaceState({}, "", "/signup");
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/signup");
    const before = commands().length;
    window.history.replaceState({}, "", "/register-business/secret-registration-token?phone=private");
    analytics.synchronizeMarketingAnalytics(window.location.pathname);
    analytics.trackMarketingEvent("sign_up");
    analytics.trackMarketingEvent("business_registered" as never);
    expect(commands()).toHaveLength(before);
    expect(commands().filter(command => command[1] === "page_view")).toHaveLength(1);
    expect(JSON.stringify(commands())).not.toMatch(/secret-registration-token|phone|private/);
    window.history.replaceState({}, "", "/products");
    analytics.synchronizeMarketingAnalytics("/products");
    analytics.trackMarketingEvent("sign_up");
    analytics.trackMarketingEvent("contact_whatsapp_click");
    expect(commands()).toHaveLength(before);
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`]).toBe(true);
  });

  it("withdraws immediately and removes only Google cookies", async () => {
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/");
    document.cookie = "_ga=google-cookie; Path=/";
    document.cookie = "_ga_TEST123456=stream-cookie; Path=/";
    document.cookie = "bazaar_acquisition=first-party-labels; Path=/";
    const before = commands().length;
    analytics.writeAnalyticsConsent("denied");
    analytics.trackMarketingEvent("contact_whatsapp_click");
    expect(commands()).toHaveLength(before);
    expect(document.querySelector("script")).toBeNull();
    expect(document.cookie).not.toMatch(/_ga=/);
    expect(document.cookie).not.toMatch(/_ga_TEST123456=/);
    expect(document.cookie).toContain("bazaar_acquisition=first-party-labels");
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`]).toBe(true);
  });

  it("does not restore a past permission after the persisted choice is cleared", async () => {
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/");
    const before = commands().length;
    localStorage.removeItem("bazaar_analytics_consent_v1");
    expect(analytics.readAnalyticsConsent()).toBeNull();
    analytics.synchronizeMarketingAnalytics("/");
    analytics.trackMarketingEvent("contact_whatsapp_click");
    expect(commands()).toHaveLength(before);
    expect(document.querySelector("script")).toBeNull();
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`]).toBe(true);
  });

  it("respects a current refusal even when storage is read-only and contains an older grant", async () => {
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/");
    const before = commands().length;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Storage blocked", "SecurityError"); });
    analytics.writeAnalyticsConsent("denied");
    expect(analytics.readAnalyticsConsent()).toBe("denied");
    analytics.synchronizeMarketingAnalytics("/");
    expect(commands()).toHaveLength(before);
    expect(document.querySelector("script")).toBeNull();
  });

  it("keeps a private document's Back/Forward history free of SDK bootstrap after public client navigation", async () => {
    const tokenPath = "/register-business/synthetic-history-token";
    window.history.replaceState({}, "", tokenPath);
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    window.history.pushState({}, "", "/ru"); // A programmatic navigation bypasses link capture.
    const replace = vi.fn();
    analytics.synchronizeMarketingAnalytics("/ru", replace);
    expect(replace).toHaveBeenCalledExactlyOnceWith(window.location.origin + "/ru");
    expect(document.querySelector("script")).toBeNull();
    expect(commands()).toEqual([]);
    await new Promise<void>(resolve => {
      window.addEventListener("popstate", () => resolve(), { once: true });
      window.history.back();
    });
    expect(window.location.pathname).toBe(tokenPath);
    analytics.synchronizeMarketingAnalytics(tokenPath, replace);
    expect(document.querySelector("script")).toBeNull();
    await new Promise<void>(resolve => {
      window.addEventListener("popstate", () => resolve(), { once: true });
      window.history.forward();
    });
    analytics.synchronizeMarketingAnalytics("/ru", replace);
    expect(replace).toHaveBeenCalledTimes(1); // Await the fresh document, never initialize into this history.
    expect(document.querySelector("script")).toBeNull();
    expect(commands()).toEqual([]);
  });

  it("does not initialize a stale public React route after the actual URL became private", async () => {
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    window.history.pushState({}, "", "/register-business/synthetic-race-token");
    analytics.synchronizeMarketingAnalytics("/ru");
    expect(document.querySelector("script")).toBeNull();
    expect(commands()).toEqual([]);
  });

  it.each([true, false])("isolates private-to-public links only when analytics is configured: %s", async enabled => {
    vi.stubEnv("NEXT_PUBLIC_GA4_ENABLED", String(enabled));
    window.history.replaceState({}, "", "/login");
    const analytics = await import("@/lib/marketingAnalytics");
    const anchor = document.createElement("a");
    anchor.href = "/ru";
    const assign = vi.fn();
    let intercepted = false;
    anchor.addEventListener("click", event => {
      analytics.interceptPrivateMarketingLink(event, assign);
      intercepted = event.defaultPrevented;
      event.preventDefault();
    });
    document.body.appendChild(anchor);
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(intercepted).toBe(enabled);
    expect(assign).toHaveBeenCalledTimes(enabled ? 1 : 0);
    expect(document.querySelector("script")).toBeNull();
    expect(commands()).toEqual([]);
  });

  it.each([
    { name: "ctrl", init: { ctrlKey: true } },
    { name: "meta", init: { metaKey: true } },
    { name: "new tab", target: "_blank" },
    { name: "download", download: true },
  ])("preserves a private-to-public $name link's browser behavior", async options => {
    window.history.replaceState({}, "", "/login");
    const analytics = await import("@/lib/marketingAnalytics");
    const anchor = document.createElement("a");
    anchor.href = "/ru";
    if (options.target) anchor.target = options.target;
    if (options.download) anchor.download = "export";
    const assign = vi.fn();
    let intercepted = false;
    anchor.addEventListener("click", event => {
      analytics.interceptPrivateMarketingLink(event, assign);
      intercepted = event.defaultPrevented;
      event.preventDefault();
    });
    document.body.appendChild(anchor);
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...options.init }));
    expect(intercepted).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    expect(commands()).toEqual([]);
  });

  it("crosses to a fresh private document only after Google was initialized, disabling it before navigation", async () => {
    const analytics = await import("@/lib/marketingAnalytics");
    const spa = vi.fn();
    const hard = vi.fn(() => {
      expect((window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`]).toBe(true);
      expect(document.querySelector("script")).toBeNull();
    });
    analytics.replaceAfterMarketingSuccess("/register-business/secret-token", spa, hard);
    expect(spa).toHaveBeenCalledExactlyOnceWith("/register-business/secret-token");
    expect(hard).not.toHaveBeenCalled();
    window.history.replaceState({}, "", "/signup");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/signup");
    analytics.replaceAfterMarketingSuccess("/register-business/secret-token", spa, hard);
    expect(spa).toHaveBeenCalledTimes(1);
    expect(hard).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/register-business/secret-token`);
    expect(JSON.stringify(commands())).not.toContain("secret-token");
  });

  it.each([
    { name: "ctrl click", init: { ctrlKey: true } },
    { name: "meta click", init: { metaKey: true } },
    { name: "shift click", init: { shiftKey: true } },
    { name: "alt click", init: { altKey: true } },
    { name: "middle click", init: { button: 1 } },
    { name: "new tab", target: "_blank" },
    { name: "named frame", target: "other-frame" },
    { name: "download", download: true },
    { name: "public navigation", href: "/signup" },
    { name: "external navigation", href: "https://example.invalid/" },
  ])("preserves ordinary $name behavior", async options => {
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/");
    const anchor = document.createElement("a");
    anchor.href = options.href ?? "/login";
    if (options.target) anchor.target = options.target;
    if (options.download) anchor.download = "export";
    const assign = vi.fn();
    let intercepted = true;
    anchor.addEventListener("click", event => {
      analytics.interceptPrivateMarketingLink(event, assign);
      intercepted = event.defaultPrevented;
      event.preventDefault(); // Do not navigate the jsdom test document.
    });
    document.body.appendChild(anchor);
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...options.init }));
    expect(intercepted).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`]).toBe(false);
  });

  it("isolates same-tab private links before a router can expose private URL to the loaded SDK", async () => {
    const analytics = await import("@/lib/marketingAnalytics");
    analytics.writeAnalyticsConsent("granted");
    analytics.synchronizeMarketingAnalytics("/");
    const anchor = document.createElement("a");
    anchor.href = "/login";
    anchor.innerHTML = "<span>Sign in</span>";
    const assign = vi.fn(() => {
      expect((window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`]).toBe(true);
    });
    anchor.addEventListener("click", event => analytics.interceptPrivateMarketingLink(event, assign));
    document.body.appendChild(anchor);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.firstChild!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(assign).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/login`);
  });

  it("expires stored consent and ignores malformed or future choices", async () => {
    const analytics = await import("@/lib/marketingAnalytics");
    const now = Date.now();
    for (const raw of ["{", "null", JSON.stringify({ version: 1, choice: "granted", at: now + 1 }),
      JSON.stringify({ version: 1, choice: "granted", at: now - 180 * 86400000 })]) {
      localStorage.setItem("bazaar_analytics_consent_v1", raw);
      expect(analytics.readAnalyticsConsent(now)).toBeNull();
    }
  });
});
