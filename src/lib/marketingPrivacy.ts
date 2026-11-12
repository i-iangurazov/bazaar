// Shared privacy boundary for optional public-site measurement providers.
export function analyticsPrivacyOptOut() {
  if (typeof window === "undefined") return true;
  const browser = navigator as Navigator & { globalPrivacyControl?: boolean };
  return browser.globalPrivacyControl === true || ["1", "yes"].includes(browser.doNotTrack ?? "");
}

export function publicMarketingPage(pathname: string) {
  if (["/", "/ru", "/kg", "/en"].includes(pathname))
    return { path: pathname, title: "BAZAAR" };
  if (pathname === "/signup") return { path: pathname, title: "BAZAAR — Sign up" };
  if (pathname === "/privacy") return { path: pathname, title: "BAZAAR — Privacy" };
  return null;
}
