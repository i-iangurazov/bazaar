// Optional marketing measurement. Never pass form values, account/business IDs,
// arbitrary parameters, URL queries, referrers or registration tokens to Google.
import { marketingCampaignOverrides } from "@/lib/marketingCampaigns";

const consentKey = "bazaar_analytics_consent_v1";
const consentLifetime = 180 * 24 * 60 * 60 * 1000;
const scriptId = "bazaar-marketing-analytics";
const origin = "https://www.bazaar.kg";
const signupEventTimeout = 1000;

export type AnalyticsConsent = "granted" | "denied";
export type MarketingEvent =
  | "contact_whatsapp_click"
  | "access_request_submitted"
  | "sign_up";

type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

let sessionConsent: AnalyticsConsent | null = null;
let initializedId: string | null = null;
let lastPage: string | null = null;
// A private page can enter the public site through client navigation. Loading
// Google into that document would also load it into its private Back history.
let documentHasPrivateContext = typeof window !== "undefined" && !publicMarketingPage(window.location.pathname);
let replacingPrivateDocument = false;

export function marketingMeasurementId() {
  // Enable only after the web stream's Enhanced Measurement is disabled and
  // synthetic network QA confirms that private URLs/form data are not sent.
  if (process.env.NEXT_PUBLIC_GA4_ENABLED !== "true") return null;
  const value = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID ?? "";
  return /^G-[A-Z0-9]{6,20}$/.test(value) ? value : null;
}

export function analyticsPrivacyOptOut() {
  if (typeof window === "undefined") return true;
  const browser = navigator as Navigator & { globalPrivacyControl?: boolean };
  return browser.globalPrivacyControl === true || ["1", "yes"].includes(browser.doNotTrack ?? "");
}

export function readAnalyticsConsent(now = Date.now()): AnalyticsConsent | null {
  if (typeof window === "undefined") return null;
  // An explicit choice still applies in this document if persistence failed.
  if (sessionConsent !== null) return sessionConsent;
  try {
    const raw = localStorage.getItem(consentKey);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !["granted", "denied"].includes(saved.choice) ||
      !Number.isFinite(saved.at) || saved.at > now || now - saved.at >= consentLifetime)
      return null;
    return saved.choice;
  } catch {
    return sessionConsent;
  }
}

export function writeAnalyticsConsent(choice: AnalyticsConsent) {
  sessionConsent = choice;
  try {
    localStorage.setItem(consentKey, JSON.stringify({ version: 1, choice, at: Date.now() }));
    // Clearing a successfully saved choice must never revive an old permission.
    sessionConsent = null;
  } catch {
    // Registration and the current choice still work with blocked storage.
  }
  if (choice === "denied") stopMarketingAnalytics();
  window.dispatchEvent(new Event("bazaar:analytics-consent"));
}

// Exact public routes only. Business registration has a secret token in its URL
// and is measured only by the first-party database report, never by this SDK.
export function publicMarketingPage(pathname: string) {
  if (["/", "/ru", "/kg", "/en"].includes(pathname))
    return { path: pathname, title: "BAZAAR" };
  if (pathname === "/signup") return { path: pathname, title: "BAZAAR — Sign up" };
  if (pathname === "/privacy") return { path: pathname, title: "BAZAAR — Privacy" };
  return null;
}

function setDisabled(value: boolean) {
  const id = initializedId ?? marketingMeasurementId();
  if (id) (window as unknown as Record<string, unknown>)[`ga-disable-${id}`] = value;
}

export function pauseMarketingAnalytics() {
  if (typeof window === "undefined") return;
  setDisabled(true);
  lastPage = null;
  document.getElementById(scriptId)?.remove();
}

// A loaded third-party SDK cannot be unloaded from an SPA by removing its tag.
// Cross into private pages with a fresh document if it has ever been initialized.
// Before initialization (the default), retain the established Next.js navigation.
export function replaceAfterMarketingSuccess(
  path: string,
  spaReplace: (path: string) => void,
  documentReplace: (url: string) => void = url => window.location.replace(url),
) {
  const target = new URL(path, window.location.origin);
  if (initializedId && target.origin === window.location.origin && !publicMarketingPage(target.pathname)) {
    pauseMarketingAnalytics();
    documentReplace(target.href);
    return;
  }
  spaReplace(path);
}

export function interceptPrivateMarketingLink(
  event: MouseEvent,
  documentAssign: (url: string) => void = url => window.location.assign(url),
) {
  if ((!marketingMeasurementId() && !initializedId) || event.defaultPrevented ||
    event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download") ||
    (anchor.target && anchor.target.toLowerCase() !== "_self") ||
    anchor.origin !== window.location.origin) return;
  const fromPublic = Boolean(publicMarketingPage(window.location.pathname));
  const toPublic = Boolean(publicMarketingPage(anchor.pathname));
  if (fromPublic === toPublic || (fromPublic && !initializedId)) return;
  // Ctrl/meta/target navigations above already create a separate document and
  // must retain their normal browser behavior. Only replace the same-tab SPA hop.
  event.preventDefault();
  pauseMarketingAnalytics();
  documentAssign(anchor.href);
}

export function stopMarketingAnalytics() {
  if (typeof window === "undefined") return;
  // A disabled/unconfigured feature must not alter cookies from another setup.
  // A known ID can still have cookies from an earlier consented visit.
  if (!initializedId && !marketingMeasurementId()) return;
  pauseMarketingAnalytics();
  // Remove only GA cookies, never authentication or first-party source cookies.
  for (const entry of document.cookie.split(";")) {
    const name = entry.trim().split("=")[0];
    if (!/^_ga(?:_|$)/.test(name)) continue;
    const expires = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    document.cookie = expires;
    const hostname = window.location.hostname;
    document.cookie = `${expires}; Domain=${hostname}`;
    if (hostname === "bazaar.kg" || hostname.endsWith(".bazaar.kg"))
      document.cookie = `${expires}; Domain=bazaar.kg`;
  }
}

function consentAllowsAnalytics() {
  return !analyticsPrivacyOptOut() && readAnalyticsConsent() === "granted";
}

export function synchronizeMarketingAnalytics(
  pathname: string,
  documentReplace: (url: string) => void = url => window.location.replace(url),
) {
  if (typeof window === "undefined") return;
  const actualPath = window.location.pathname;
  const page = publicMarketingPage(actualPath);
  if (!page) documentHasPrivateContext = true;
  const id = marketingMeasurementId();
  if (!id || !consentAllowsAnalytics()) {
    stopMarketingAnalytics();
    return;
  }
  if (!page || actualPath !== pathname) {
    pauseMarketingAnalytics();
    return;
  }
  // This also catches programmatic/history navigation that bypassed link capture.
  // No SDK is created in a document that contains a private route in its history.
  if (documentHasPrivateContext) {
    pauseMarketingAnalytics();
    if (!replacingPrivateDocument) {
      replacingPrivateDocument = true;
      documentReplace(window.location.href);
    }
    return;
  }
  setDisabled(false);
  const analytics = window as AnalyticsWindow;
  const pageContext = {
    page_location: origin + page.path, page_referrer: "", page_title: page.title,
  };
  if (initializedId !== id) {
    analytics.dataLayer = analytics.dataLayer ?? [];
    analytics.gtag = function () {
      // The official gtag command queue uses the argument record, not flattened values.
      // eslint-disable-next-line prefer-rest-params
      analytics.dataLayer!.push(arguments);
    };
    // The tag is created only after our explicit-consent guard. Initialize with
    // that known choice before config, without a denied-to-granted reconfiguration
    // that can produce another automatic page_view in the real SDK.
    analytics.gtag("consent", "default", {
      analytics_storage: "granted", ad_storage: "denied",
      ad_user_data: "denied", ad_personalization: "denied",
    });
    // Safe global defaults also cover automatic engagement/session parameters.
    analytics.gtag("set", {
      send_page_view: false,
      ...pageContext,
      allow_google_signals: false, allow_ad_personalization_signals: false,
      ...marketingCampaignOverrides(new URLSearchParams(window.location.search)),
    });
    analytics.gtag("js", new Date());
    analytics.gtag("config", id, {
      send_page_view: false, allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    initializedId = id;
  } else {
    // Engagement uses global context too. Update only from the exact public
    // allowlist, before the manual view, without re-running config or leaking URL data.
    analytics.gtag?.("set", { send_page_view: false, ...pageContext });
  }
  if (!document.getElementById(scriptId) && page) {
    const script = document.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    script.onerror = () => script.remove(); // Retry on a later public visit.
    document.head.appendChild(script);
  }
  if (page && lastPage !== pathname) {
    analytics.gtag?.("event", "page_view", {
      send_to: id, page_location: origin + page.path,
      page_referrer: "", page_title: page.title,
    });
    lastPage = pathname;
  }
  if (!page) lastPage = null;
}

function sendMarketingEvent(event: MarketingEvent, onProcessed?: () => void) {
  if (!["contact_whatsapp_click", "access_request_submitted", "sign_up"].includes(event)) return false;
  const id = marketingMeasurementId();
  if (!consentAllowsAnalytics()) {
    stopMarketingAnalytics();
    return false;
  }
  const gtag = (window as AnalyticsWindow).gtag;
  if (!id || initializedId !== id || !gtag) return false;
  const path = window.location.pathname;
  const signupEvent = event === "sign_up" || event === "access_request_submitted";
  if (signupEvent && path !== "/signup") return false;
  if (event === "contact_whatsapp_click" && !publicMarketingPage(path)) return false;
  gtag("event", event, {
    send_to: id,
    page_location: origin + (event === "contact_whatsapp_click" ? publicMarketingPage(path)!.path : "/signup"),
    page_referrer: "", page_title: "BAZAAR",
    ...(event === "sign_up" ? { method: "email" } : {}),
    ...(onProcessed ? { event_callback: onProcessed, event_timeout: signupEventTimeout } : {}),
  });
  return true;
}

export function trackMarketingEvent(event: MarketingEvent) {
  sendMarketingEvent(event);
}

// A successful registration must leave the public document only after the SDK
// can process its event. The independent deadline also covers blocked/unloaded
// SDKs; analytics must never prevent onboarding or repeat the successful API call.
// A callback is a processing acknowledgement, not proof of server/report receipt.
export function trackSignupBeforeNavigation(): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(finish, signupEventTimeout);
    try {
      if (!sendMarketingEvent("sign_up", finish)) finish();
    } catch {
      finish();
    }
  });
}
