// Shared privacy boundary for optional public-site measurement providers.
import { parseMarketingSolutionPath, type SolutionId } from "@/lib/marketingSolutions";

const solutionPageTitles: Record<SolutionId, string> = {
  inventory: "BAZAAR — Inventory management",
  pos: "BAZAAR — Retail POS",
  warehouse: "BAZAAR — Warehouse management",
  grocery: "BAZAAR — Grocery stores",
  clothing: "BAZAAR — Clothing stores",
  "store-guide": "BAZAAR — Store accounting guide",
};

export function analyticsPrivacyOptOut() {
  if (typeof window === "undefined") return true;
  const browser = navigator as Navigator & { globalPrivacyControl?: boolean };
  return browser.globalPrivacyControl === true || ["1", "yes"].includes(browser.doNotTrack ?? "");
}

export function publicMarketingPage(pathname: string) {
  if (["/", "/ru", "/kg", "/en"].includes(pathname))
    return { path: pathname, title: "BAZAAR" };
  const solution = parseMarketingSolutionPath(pathname);
  if (solution && !solution.isAlias)
    return {
      path: pathname,
      title: solution.id ? solutionPageTitles[solution.id] : "BAZAAR — Solutions",
    };
  if (pathname === "/signup") return { path: pathname, title: "BAZAAR — Sign up" };
  if (pathname === "/privacy") return { path: pathname, title: "BAZAAR — Privacy" };
  return null;
}
