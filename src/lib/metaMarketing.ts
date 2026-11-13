import { marketingCampaignOverrides } from "@/lib/marketingCampaigns";
import { analyticsPrivacyOptOut, publicMarketingPage } from "@/lib/marketingPrivacy";
import { isNativeApp } from "@/lib/native/platform";

const consentKey = "bazaar_meta_measurement_consent_v1";
const consentLifetime = 180 * 24 * 60 * 60 * 1000;
const scriptId = "bazaar-meta-measurement";
const signupDeadline = 1000;
const publicLandingFragments = ["#platform", "#pos", "#inventory", "#commerce", "#analytics", "#mobile", "#pricing"];
type Choice = "granted" | "denied";
type Pixel = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push?: Pixel;
  loaded: boolean;
  version: string;
  disablePushState: boolean;
};
type PixelWindow = Window & { fbq?: Pixel; _fbq?: Pixel };
let sessionChoice: Choice | null = null;
let ownedPixel: Pixel | null = null;
let initializedId: string | null = null;
let everInitialized = false;
let withdrawnInDocument = false;
let unsafeDocument = typeof window !== "undefined" && !safeMetaContext();
let lastPage: string | null = null;
let failedPage: string | null = null;
let replacingDocument = false;
let signupHandled = false;
let pendingSignup: (() => void) | null = null;

function nativeMetaContext() {
  // Native shells use the same production origin. Website advertising consent
  // never authorizes tracking the iOS/Android app or replaces ATT permission.
  if (/\bBazaarNative(?:Android|IOS)?\//i.test(navigator.userAgent)) return true;
  try { return isNativeApp(); }
  catch { return true; } // An unavailable native-platform probe fails closed.
}

// An empty value leaves Meta completely disconnected, including its consent UI.
export function metaMeasurementId() {
  if (typeof window !== "undefined" && nativeMetaContext()) return null;
  const id = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "";
  return /^[0-9]{8,25}$/.test(id) ? id : null;
}

export function readMetaConsent(now = Date.now()): Choice | null {
  if (typeof window === "undefined") return null;
  if (sessionChoice !== null) return sessionChoice;
  try {
    const raw = localStorage.getItem(consentKey);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !["granted", "denied"].includes(value.choice) ||
      !Number.isFinite(value.at) || value.at > now || now - value.at >= consentLifetime) return null;
    return value.choice as Choice;
  } catch { return sessionChoice; }
}

export function writeMetaConsent(choice: Choice) {
  sessionChoice = choice;
  try {
    localStorage.setItem(consentKey, JSON.stringify({ version: 1, choice, at: Date.now() }));
    sessionChoice = null;
  } catch { /* A blocked store never prevents signup or the current choice. */ }
  if (choice === "denied") stopMetaMeasurement();
  window.dispatchEvent(new Event("bazaar:meta-consent"));
}

// Pixel collects document.location/referrer itself. Never pretend that a custom
// event property overrides those fields. Reject unsafe contexts before loading.
function safePublicUrl(url: URL) {
  if (url.username || url.password || !publicMarketingPage(url.pathname)) return false;
  // These literal anchors are linked by the landing itself, not visitor data.
  // Never accept arbitrary fragments or carry this exception into signup/privacy.
  if (url.hash && (!["/", "/ru", "/kg", "/en"].includes(url.pathname) ||
    !publicLandingFragments.includes(url.hash))) return false;
  const search = url.searchParams;
  const campaignFields = {
    utm_source: "campaign_source", utm_medium: "campaign_medium", utm_campaign: "campaign_name",
    utm_content: "campaign_content", utm_term: "campaign_term", utm_id: "campaign_id",
  } as const;
  const campaignKeys = Object.keys(campaignFields);
  const reviewed = marketingCampaignOverrides(search);
  // The acquisition parser deliberately drops invalid fields and normalizes
  // labels. That is safe for GA's explicit overrides, not for Pixel's raw URL.
  // Every supplied raw label must exactly equal a reviewed exported value.
  for (const [key, field] of Object.entries(campaignFields)) {
    if (search.has(key) && (!reviewed[field] || search.get(key) !== reviewed[field])) return false;
  }
  for (const key of Array.from(search.keys())) {
    if (search.getAll(key).length !== 1) return false;
    if (campaignKeys.includes(key)) continue;
    if (key !== "fbclid" || !/^[A-Za-z0-9_-]{1,512}$/.test(search.get(key) ?? "")) return false;
  }
  return true;
}

export function safeMetaContext() {
  if (typeof window === "undefined" || nativeMetaContext()) return false;
  try {
    const current = new URL(window.location.href);
    const production = ["https://www.bazaar.kg", "https://bazaar.kg"].includes(current.origin);
    const isolatedTest = process.env.NODE_ENV === "test" && ["localhost", "127.0.0.1"].includes(current.hostname);
    if ((!production && !isolatedTest) || !safePublicUrl(current)) return false;
    if (!document.referrer) return true;
    const referrer = new URL(document.referrer);
    if (referrer.origin === current.origin) return safePublicUrl(referrer);
    // Cross-origin browser referrers normally contain only the origin. Never
    // accept full Instagram redirect/profile URLs or unknown external referrers.
    return referrer.protocol === "https:" && referrer.pathname === "/" && !referrer.search &&
      !referrer.hash && !referrer.username && !referrer.password &&
      ["instagram.com", "www.instagram.com", "l.instagram.com", "facebook.com", "www.facebook.com",
        "m.facebook.com", "l.facebook.com", "www.google.com", "www.bing.com"].includes(referrer.hostname);
  } catch { return false; }
}

export function metaHasInitialized() { return everInitialized; }

function permitted() {
  return !unsafeDocument && !withdrawnInDocument && !analyticsPrivacyOptOut() &&
    readMetaConsent() === "granted" && safeMetaContext();
}

export function pauseMetaMeasurement() {
  if (typeof window === "undefined") return;
  if (ownedPixel) {
    // No measurement events are queued before SDK onload. Clear bootstrap
    // commands too so a late script cannot replay previously withdrawn work.
    if (!ownedPixel.callMethod) ownedPixel.queue.length = 0;
    try { ownedPixel("consent", "revoke"); } catch { /* Optional SDK. */ }
  }
  if (everInitialized) withdrawnInDocument = true;
  document.getElementById(scriptId)?.remove();
  pendingSignup?.();
  pendingSignup = null;
  lastPage = null;
}

export function stopMetaMeasurement() {
  pauseMetaMeasurement();
  if (!everInitialized && !metaMeasurementId()) return;
  try {
    for (const entry of document.cookie.split(";")) {
      const name = entry.trim().split("=")[0];
      if (!["_fbp", "_fbc"].includes(name)) continue;
      const expired = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
      document.cookie = expired;
      document.cookie = `${expired}; Domain=${window.location.hostname}`;
      if (window.location.hostname === "bazaar.kg" || window.location.hostname.endsWith(".bazaar.kg"))
        document.cookie = `${expired}; Domain=bazaar.kg`;
    }
  } catch { /* Restricted browser storage must not prevent withdrawal. */ }
}

function ready() { return Boolean(ownedPixel?.callMethod) && initializedId === metaMeasurementId(); }

function sendPageView() {
  if (!permitted() || !ready()) return;
  const path = window.location.pathname;
  if (lastPage === path) return;
  try {
    ownedPixel!("trackSingle", initializedId, "PageView");
    lastPage = path;
  } catch { /* Measurement cannot break public navigation. */ }
}

export function synchronizeMetaMeasurement(
  pathname: string,
  documentReplace: (url: string) => void = url => window.location.replace(url),
) {
  try { synchronizeMetaMeasurementInternal(pathname, documentReplace); }
  catch { pauseMetaMeasurement(); }
}

function synchronizeMetaMeasurementInternal(pathname: string, documentReplace: (url: string) => void) {
  if (typeof window === "undefined") return;
  const contextSafe = safeMetaContext();
  if (!contextSafe) unsafeDocument = true;
  const id = metaMeasurementId();
  if (!id || analyticsPrivacyOptOut() || readMetaConsent() !== "granted") {
    stopMetaMeasurement();
    return;
  }
  if (!contextSafe || window.location.pathname !== pathname) {
    pauseMetaMeasurement();
    return;
  }
  if (unsafeDocument) {
    pauseMetaMeasurement();
    if (!replacingDocument) {
      replacingDocument = true;
      documentReplace(window.location.href);
    }
    return;
  }
  if (withdrawnInDocument || failedPage === pathname) return;
  if (ownedPixel) { sendPageView(); return; }
  const browser = window as PixelWindow;
  // Do not overwrite a tracker installed by another integration.
  if (browser.fbq || browser._fbq) return;
  const pixel = function (...args: unknown[]) {
    if (pixel.callMethod) pixel.callMethod(...args);
    else pixel.queue.push(args);
  } as Pixel;
  pixel.queue = [];
  pixel.push = pixel;
  pixel.loaded = true;
  pixel.version = "2.0";
  // Supported by Meta's own GTM template. Disable automatic SPA PageViews.
  pixel.disablePushState = true;
  browser.fbq = browser._fbq = pixel;
  ownedPixel = pixel;
  initializedId = id;
  everInitialized = true;
  // Reaching bootstrap already requires a separate explicit Meta grant. Match
  // Meta's supported GTM ordering: consent first, then configuration and init.
  // No SDK or measurement request exists before that permission.
  pixel("consent", "grant");
  pixel("set", "autoConfig", false, id);
  pixel("init", id); // No customer data / advanced matching parameters.
  const script = document.createElement("script");
  script.id = scriptId;
  script.async = true;
  script.referrerPolicy = "no-referrer";
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  script.onload = () => { sendPageView(); pendingSignup?.(); };
  script.onerror = () => {
    failedPage = window.location.pathname;
    pixel.queue.length = 0;
    script.remove();
    if (browser.fbq === pixel) delete browser.fbq;
    if (browser._fbq === pixel) delete browser._fbq;
    ownedPixel = null;
    initializedId = null;
    pendingSignup?.();
    pendingSignup = null;
  };
  document.head.appendChild(script);
}

// Account creation, not a page visit, click, onboarding resume, trial activation,
// subscription or purchase. An SDK acknowledgement is not server receipt proof.
export function trackMetaSignupBeforeNavigation(): Promise<void> {
  if (typeof window === "undefined" || signupHandled || window.location.pathname !== "/signup" || !permitted())
    return Promise.resolve();
  signupHandled = true;
  synchronizeMetaMeasurement("/signup");
  if (!ownedPixel) return Promise.resolve();
  return new Promise(resolve => {
    let sent = false;
    let settled = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (grace) clearTimeout(grace);
      pendingSignup = null;
      resolve();
    };
    const deadline = setTimeout(finish, signupDeadline);
    const send = () => {
      if (!permitted() || !ownedPixel) { finish(); return; }
      if (!ready() || sent) return;
      sent = true;
      try { ownedPixel("trackSingle", initializedId, "CompleteRegistration"); }
      catch { finish(); return; }
      // Pixel has no event_callback API. Give its request a short bounded chance
      // to start, then continue onboarding even if the network is blocked.
      grace = setTimeout(finish, 150);
    };
    pendingSignup = send;
    send();
  });
}
