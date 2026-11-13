// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativeState = vi.hoisted(() => ({ native: false, failed: false }));
vi.mock("@/lib/native/platform", () => ({ isNativeApp: () => {
  if (nativeState.failed) throw new Error("Native probe unavailable");
  return nativeState.native;
} }));

type Pixel = ((...args: unknown[]) => void) & { queue: unknown[][]; callMethod?: (...args: unknown[]) => void; disablePushState: boolean };
type PixelWindow = Window & { fbq?: Pixel; _fbq?: Pixel };
const pixelId = "1635457884748007";
const observedMetaQuery = "utm_source=instagram&utm_medium=paid_social&utm_campaign=bishkek_take6&utm_content=take6_landing&utm_id=52573740529697&utm_term=52573740529897";
const script = () => document.getElementById("bazaar-meta-measurement") as HTMLScriptElement | null;
const browser = () => window as PixelWindow;
function sdkLoaded() {
  const send = vi.fn();
  browser().fbq!.callMethod = send;
  script()!.dispatchEvent(new Event("load"));
  return send;
}

beforeEach(() => {
  nativeState.native = false; nativeState.failed = false;
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", pixelId);
  vi.stubEnv("NEXT_PUBLIC_GA4_ENABLED", "false");
  localStorage.clear(); sessionStorage.clear();
  document.head.innerHTML = ""; document.body.innerHTML = "";
  for (const cookie of document.cookie.split(";"))
    document.cookie = `${cookie.trim().split("=")[0]}=; Max-Age=0; Path=/`;
  delete browser().fbq; delete browser()._fbq;
  Object.defineProperty(document, "referrer", { configurable: true, value: "" });
  Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "0" });
  window.history.replaceState({}, "", "/ru");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("separate consented Meta registration measurement", () => {
  it("keeps a native Capacitor app outside website Meta measurement", async () => {
    nativeState.native = true;
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    expect(meta.metaMeasurementId()).toBeNull(); expect(meta.safeMetaContext()).toBe(false);
    expect(script()).toBeNull(); expect(browser().fbq).toBeUndefined();
  });

  it.each(["BazaarNative/1.0.0 (production)", "BazaarNativeIOS/1.0.0", "BazaarNativeAndroid/1.0.0"])("blocks native UA before the Capacitor bridge is available: %s", async suffix => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(`Mozilla/5.0 ${suffix}`);
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    expect(meta.metaMeasurementId()).toBeNull(); expect(meta.safeMetaContext()).toBe(false);
    expect(script()).toBeNull(); expect(browser().fbq).toBeUndefined();
  });

  it("fails closed when the native-platform probe is unavailable", async () => {
    nativeState.failed = true;
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    expect(meta.metaMeasurementId()).toBeNull(); expect(script()).toBeNull();
  });

  it("stays entirely disconnected with an empty pixel ID and preserves unrelated cookies", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "");
    document.cookie = "_fbp=other-installation; Path=/";
    const meta = await import("@/lib/metaMarketing");
    meta.synchronizeMetaMeasurement("/ru");
    await meta.trackMetaSignupBeforeNavigation();
    expect(script()).toBeNull();
    expect(browser().fbq).toBeUndefined();
    expect(document.cookie).toContain("_fbp=other-installation");
  });

  it("never upgrades Google advertising permission into Meta permission", async () => {
    localStorage.setItem("bazaar_marketing_consent_v2", JSON.stringify({ version: 2, analytics: "granted", advertising: "granted", at: Date.now() }));
    const meta = await import("@/lib/metaMarketing");
    expect(meta.readMetaConsent()).toBeNull();
    meta.synchronizeMetaMeasurement("/ru");
    expect(script()).toBeNull();
    meta.writeMetaConsent("denied");
    expect(JSON.parse(localStorage.getItem("bazaar_marketing_consent_v2")!).advertising).toBe("granted");
    expect(browser().fbq).toBeUndefined();
  });

  it("loads only after Meta permission, disables automatic collection, and sends one manual PageView", async () => {
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted");
    meta.synchronizeMetaMeasurement("/ru");
    expect(script()?.src).toBe("https://connect.facebook.net/en_US/fbevents.js");
    expect(script()?.referrerPolicy).toBe("no-referrer");
    expect(browser().fbq?.disablePushState).toBe(true);
    expect(browser().fbq?.queue).toEqual([
      ["consent", "grant"], ["set", "autoConfig", false, pixelId],
      ["init", pixelId],
    ]);
    const send = sdkLoaded();
    meta.synchronizeMetaMeasurement("/ru");
    expect(send.mock.calls).toEqual([["trackSingle", pixelId, "PageView"]]);
  });

  it("counts one successful new account on signup without forwarding any form values", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/signup");
    document.body.innerHTML = '<input name="email" value="private@example.invalid"><input name="password" value="private-password">';
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/signup");
    const send = sdkLoaded();
    const measurement = meta.trackMetaSignupBeforeNavigation();
    await meta.trackMetaSignupBeforeNavigation();
    await vi.advanceTimersByTimeAsync(150); await measurement;
    expect(send.mock.calls).toEqual([
      ["trackSingle", pixelId, "PageView"], ["trackSingle", pixelId, "CompleteRegistration"],
    ]);
    expect(JSON.stringify(send.mock.calls)).not.toMatch(/private|email|password|Purchase|Subscribe/);
  });

  it.each(["/ru", "/register-business/private-token", "/products", "/login"])("does not report an account conversion from %s", async path => {
    window.history.replaceState({}, "", path);
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement(path);
    const send = script() ? sdkLoaded() : vi.fn();
    await meta.trackMetaSignupBeforeNavigation();
    expect(send.mock.calls.flat()).not.toContain("CompleteRegistration");
  });

  it.each([
    "/ru?email=private%40example.invalid", "/ru#private-fragment", "/ru?utm_source=private",
    "/ru?fbclid=a&fbclid=b", "/ru?fbclid=https%3A%2F%2Fprivate.invalid", "/ru?gclid=google-only-id",
    "/ru?utm_source=instagram&utm_medium=paid_social&utm_campaign=bishkek_take6&utm_content=take6_signup&utm_term=private%40example.invalid",
    "/ru?utm_source=instagram&utm_medium=paid_social&utm_campaign=bishkek_take6&utm_content=take6_signup&utm_term=996700000000",
    "/ru?utm_source=INSTAGRAM&utm_medium=paid_social&utm_campaign=bishkek_take6&utm_content=take6_signup",
    "/register-business/private-token", "/api/private",
  ])("rejects an unsafe page before any Meta request: %s", async path => {
    window.history.replaceState({}, "", path);
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement(window.location.pathname);
    expect(script()).toBeNull(); expect(browser().fbq).toBeUndefined();
  });

  it.each(["take6_signup", "take6_landing"])("accepts the reviewed campaign URL %s and a bounded Meta click ID", async content => {
    window.history.replaceState({}, "", `/ru?utm_source=instagram&utm_medium=paid_social&utm_campaign=bishkek_take6&utm_content=${content}&fbclid=Valid-Meta_Click123`);
    Object.defineProperty(document, "referrer", { configurable: true, value: "https://l.instagram.com/" });
    const meta = await import("@/lib/metaMarketing");
    expect(meta.safeMetaContext()).toBe(true);
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    expect(script()).not.toBeNull();
  });

  it.each(["", "&fbclid=Valid-Meta_Click123"])("measures the observed Instagram landing only after consent, then one new-account conversion: %s", async click => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", `/ru?${observedMetaQuery}${click}`);
    Object.defineProperty(document, "referrer", { configurable: true, value: "https://instagram.com/" });
    const meta = await import("@/lib/metaMarketing");
    expect(meta.safeMetaContext()).toBe(true);
    meta.synchronizeMetaMeasurement("/ru");
    expect(script()).toBeNull(); expect(browser().fbq).toBeUndefined();
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    const send = sdkLoaded();
    meta.synchronizeMetaMeasurement("/ru");
    window.history.pushState({}, "", "/signup");
    meta.synchronizeMetaMeasurement("/signup");
    const measurement = meta.trackMetaSignupBeforeNavigation();
    await meta.trackMetaSignupBeforeNavigation();
    await vi.advanceTimersByTimeAsync(150); await measurement;
    expect(send.mock.calls).toEqual([
      ["trackSingle", pixelId, "PageView"], ["trackSingle", pixelId, "PageView"],
      ["trackSingle", pixelId, "CompleteRegistration"],
    ]);
  });

  it.each(["", "#platform", "#pos", "#inventory", "#commerce", "#analytics", "#mobile", "#pricing"])("accepts the observed landing as a fresh signup document's same-origin referrer: %s", async fragment => {
    const dispatchEvent = window.dispatchEvent.bind(window);
    vi.stubGlobal("window", { location: new URL("https://www.bazaar.kg/signup"), dispatchEvent });
    Object.defineProperty(document, "referrer", { configurable: true, value: `https://www.bazaar.kg/ru?${observedMetaQuery}&fbclid=Valid-Meta_Click123${fragment}` });
    const meta = await import("@/lib/metaMarketing");
    expect(meta.safeMetaContext()).toBe(true);
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/signup");
    expect(script()).not.toBeNull();
  });

  it.each(["/", "/ru", "/kg", "/en"].flatMap(path =>
    ["#platform", "#pos", "#inventory", "#commerce", "#analytics", "#mobile", "#pricing"].map(fragment => [path, fragment] as const),
  ))("allows the landing's literal anchor after consent on %s%s", async (path, fragment) => {
    window.history.replaceState({}, "", `${path}?${observedMetaQuery}${fragment}`);
    const meta = await import("@/lib/metaMarketing");
    expect(meta.safeMetaContext()).toBe(true);
    meta.synchronizeMetaMeasurement(path);
    expect(script()).toBeNull(); expect(browser().fbq).toBeUndefined();
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement(path);
    const send = sdkLoaded();
    expect(send.mock.calls).toEqual([["trackSingle", pixelId, "PageView"]]);
  });

  it("allows opening the hero's platform anchor before choosing Meta consent", async () => {
    window.history.replaceState({}, "", `/ru?${observedMetaQuery}`);
    const meta = await import("@/lib/metaMarketing");
    meta.synchronizeMetaMeasurement("/ru");
    window.history.pushState({}, "", `#platform`);
    expect(script()).toBeNull(); expect(browser().fbq).toBeUndefined();
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    const send = sdkLoaded();
    expect(send.mock.calls).toEqual([["trackSingle", pixelId, "PageView"]]);
  });

  it("sends the first PageView when the platform anchor opens while the consented SDK is loading", async () => {
    window.history.replaceState({}, "", `/ru?${observedMetaQuery}`);
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    window.history.pushState({}, "", "#platform");
    const send = sdkLoaded();
    meta.synchronizeMetaMeasurement("/ru");
    expect(send.mock.calls).toEqual([["trackSingle", pixelId, "PageView"]]);
  });

  it("preserves a consented landing through its anchor and signup without another landing view or forced reload", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", `/ru?${observedMetaQuery}`);
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    const send = sdkLoaded();
    const reload = vi.fn();
    window.history.pushState({}, "", "#platform");
    meta.synchronizeMetaMeasurement("/ru", reload);
    window.history.pushState({}, "", "/signup");
    meta.synchronizeMetaMeasurement("/signup", reload);
    const measurement = meta.trackMetaSignupBeforeNavigation();
    await meta.trackMetaSignupBeforeNavigation();
    await vi.advanceTimersByTimeAsync(150); await measurement;
    expect(reload).not.toHaveBeenCalled();
    expect(send.mock.calls).toEqual([
      ["trackSingle", pixelId, "PageView"], ["trackSingle", pixelId, "PageView"],
      ["trackSingle", pixelId, "CompleteRegistration"],
    ]);
  });

  it.each([
    "/ru#private-fragment", "/ru#platform-secret", "/ru#platform?email=private@example.invalid",
    "/ru#Platform", "/ru#%70latform", "/ru#platform/extra", "/ru#platform#private",
    "/ru#platform&email=private", "/ru#platform%0Aprivatedata",
    "/signup#platform", "/privacy#pricing", "/products#platform", "/register-business/private-token#platform",
  ])("keeps unreviewed or non-landing fragments blocked: %s", async candidate => {
    const url = new URL(candidate, window.location.origin);
    url.search = observedMetaQuery;
    window.history.replaceState({}, "", url.href);
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement(url.pathname);
    expect(meta.safeMetaContext()).toBe(false);
    expect(script()).toBeNull(); expect(browser().fbq).toBeUndefined();
  });

  it("still withdraws for an unknown fragment and requires a fresh document after returning to an approved anchor", async () => {
    window.history.replaceState({}, "", `/ru?${observedMetaQuery}#platform`);
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    const send = sdkLoaded();
    const reload = vi.fn();
    window.history.pushState({}, "", "#private-fragment");
    meta.synchronizeMetaMeasurement("/ru", reload);
    expect(script()).toBeNull();
    expect(send.mock.calls.at(-1)).toEqual(["consent", "revoke"]);
    window.history.pushState({}, "", "#platform");
    meta.synchronizeMetaMeasurement("/ru", reload);
    expect(reload).toHaveBeenCalledExactlyOnceWith(window.location.href);
    expect(script()).toBeNull();
    expect(send.mock.calls.filter(call => call[2] === "PageView")).toHaveLength(1);
  });

  it.each([
    "email=private%40example.invalid", "fbclid=a&fbclid=b",
    "utm_id=52573740529698", "utm_term=52573740529898",
  ])("does not use an approved anchor to bypass unsafe query fields: %s", async extra => {
    window.history.replaceState({}, "", `/ru?${observedMetaQuery}&${extra}#platform`);
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    expect(script()).toBeNull(); expect(browser().fbq).toBeUndefined();
  });

  it.each([
    ["utm_id", "52573740529698"], ["utm_id", "52573740529697x"],
    ["utm_id", "private@example.invalid"], ["utm_term", "52573740529898"],
    ["utm_term", "52573740529897x"], ["utm_term", "996700000000"],
    ["utm_campaign", "kg_store_launch_202611"], ["utm_content", "take6_signup"],
    ["utm_source", "facebook"], ["utm_medium", "organic_social"],
  ])("keeps a mismatched observed campaign blocked: %s=%s", async (key, value) => {
    const search = new URLSearchParams(observedMetaQuery);
    search.set(key, value);
    window.history.replaceState({}, "", `/ru?${search}`);
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    expect(meta.safeMetaContext()).toBe(false); expect(script()).toBeNull();
    expect(browser().fbq).toBeUndefined();
  });

  it.each([
    "utm_id=52573740529697", "utm_id=52573740529698", "utm_term=52573740529897",
    "utm_term=52573740529898", "utm_source=instagram", "nxtPlocale=ru", "email=private%40example.invalid",
  ])("does not broaden allowed raw query fields or allow duplicates: %s", async extra => {
    window.history.replaceState({}, "", `/ru?${observedMetaQuery}&${extra}`);
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    expect(meta.safeMetaContext()).toBe(false); expect(script()).toBeNull();
    expect(browser().fbq).toBeUndefined();
  });

  it.each(["utm_id", "utm_term"])("does not allow an incomplete observed identifier pair without %s", async key => {
    const search = new URLSearchParams(observedMetaQuery);
    search.delete(key);
    window.history.replaceState({}, "", `/ru?${search}`);
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    expect(script()).toBeNull(); expect(browser().fbq).toBeUndefined();
  });

  it.each(["/products", "/register-business/private-token"])("keeps private routes blocked with the reviewed IDs: %s", async path => {
    window.history.replaceState({}, "", `${path}?${observedMetaQuery}`);
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement(path);
    await meta.trackMetaSignupBeforeNavigation();
    expect(script()).toBeNull(); expect(browser().fbq).toBeUndefined();
  });

  it.each(["globalPrivacyControl", "doNotTrack"])("honors %s on the observed paid landing", async key => {
    window.history.replaceState({}, "", `/ru?${observedMetaQuery}#platform`);
    Object.defineProperty(navigator, key, { configurable: true, value: key === "doNotTrack" ? "1" : true });
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    expect(script()).toBeNull(); expect(browser().fbq).toBeUndefined();
  });

  it.each([
    "http://localhost:3000/register-business/private-token", "https://l.instagram.com/?u=private",
    "https://unreviewed.invalid/", "https://www.instagram.com/private-profile/",
    "https://instagram.com/#platform", "http://localhost:3000/ru#private-fragment",
  ])("never exposes a private or unreviewed referrer: %s", async referrer => {
    Object.defineProperty(document, "referrer", { configurable: true, value: referrer });
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    expect(script()).toBeNull(); expect(browser().fbq).toBeUndefined();
  });

  it.each(["globalPrivacyControl", "doNotTrack"])("honors %s over stored Meta permission", async key => {
    Object.defineProperty(navigator, key, { configurable: true, value: key === "doNotTrack" ? "1" : true });
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    expect(script()).toBeNull(); expect(browser().fbq).toBeUndefined();
  });

  it("revokes a pending SDK before it can replay events and deletes only Meta cookies", async () => {
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    const lateScript = script()!;
    document.cookie = "_fbp=fb-id; Path=/"; document.cookie = "_fbc=fb-click; Path=/";
    document.cookie = "auth=session; Path=/"; document.cookie = "_ga=google; Path=/";
    meta.writeMetaConsent("denied");
    expect(browser().fbq?.queue).toEqual([["consent", "revoke"]]);
    const send = vi.fn(); browser().fbq!.callMethod = send;
    lateScript.dispatchEvent(new Event("load"));
    expect(send).not.toHaveBeenCalled();
    expect(script()).toBeNull();
    expect(document.cookie).not.toMatch(/_fb[pc]=/);
    expect(document.cookie).toContain("auth=session"); expect(document.cookie).toContain("_ga=google");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/ru");
    expect(send).not.toHaveBeenCalled(); // Fresh document required after withdrawal.
  });

  it.each(["error", "timeout"])("does not hold registration when the SDK fails: %s", async mode => {
    vi.useFakeTimers(); window.history.replaceState({}, "", "/signup");
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/signup");
    let complete = false;
    const measurement = meta.trackMetaSignupBeforeNavigation().then(() => { complete = true; });
    if (mode === "error") script()!.dispatchEvent(new Event("error"));
    await vi.advanceTimersByTimeAsync(1000); await measurement;
    expect(complete).toBe(true);
    expect(browser().fbq?.queue.flat() ?? []).not.toContain("CompleteRegistration");
  });

  it("does not break signup if the browser rejects SDK script insertion", async () => {
    window.history.replaceState({}, "", "/signup");
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted");
    vi.spyOn(document.head, "appendChild").mockImplementation(() => { throw new Error("Blocked script"); });
    expect(() => meta.synchronizeMetaMeasurement("/signup")).not.toThrow();
    await expect(meta.trackMetaSignupBeforeNavigation()).resolves.toBeUndefined();
    expect(browser().fbq?.queue.flat()).not.toContain("CompleteRegistration");
  });

  it("uses a fresh document for private onboarding even with Google disabled", async () => {
    window.history.replaceState({}, "", "/signup");
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted"); meta.synchronizeMetaMeasurement("/signup");
    const send = sdkLoaded();
    const google = await import("@/lib/marketingAnalytics");
    const spa = vi.fn(); const replace = vi.fn();
    google.replaceAfterMarketingSuccess("/register-business/private-token", spa, replace);
    expect(spa).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("/register-business/private-token"));
    expect(send.mock.calls.at(-1)).toEqual(["consent", "revoke"]);
    expect(JSON.stringify(send.mock.calls)).not.toContain("private-token");
  });

  it("does not load into a public document that has already visited a private route", async () => {
    window.history.replaceState({}, "", "/products");
    const meta = await import("@/lib/metaMarketing");
    meta.writeMetaConsent("granted");
    window.history.replaceState({}, "", "/ru");
    const replace = vi.fn();
    meta.synchronizeMetaMeasurement("/ru", replace);
    expect(replace).toHaveBeenCalledExactlyOnceWith(window.location.href);
    expect(script()).toBeNull();
  });

  it("keeps account creation usable when consent storage is blocked", async () => {
    const meta = await import("@/lib/metaMarketing");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    meta.writeMetaConsent("granted");
    expect(meta.readMetaConsent()).toBe("granted");
    meta.synchronizeMetaMeasurement("/ru");
    expect(script()).not.toBeNull();
    meta.writeMetaConsent("denied");
    expect(meta.readMetaConsent()).toBe("denied");
    expect(script()).toBeNull();
  });
});
