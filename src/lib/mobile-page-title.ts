const routes = [
  ["/admin/jobs", "adminJobs"],
  ["/admin/metrics", "adminMetrics"],
  ["/admin/support", "adminSupport"],
  ["/billing", "billing"],
  ["/onboarding", "onboarding"],
  ["/platform", "platformOwner"],
  ["/help", "help"],
  ["/pos", "pos"],
  ["/cash", "pos"],
  ["/finance/income", "pos"],
  ["/finance/expense", "pos"],
  ["/products", "products"],
  ["/inventory", "inventory"],
  ["/sales", "sales"],
  ["/orders", "sales"],
  ["/purchase-orders", "purchaseOrders"],
  ["/customers", "customers"],
  ["/suppliers", "suppliers"],
  ["/baam", "baam"],
  ["/reports", "reports"],
  ["/operations/integrations", "integrations"],
  ["/stores", "stores"],
  ["/settings/price-lists", "priceLists"],
  ["/settings/printing", "printing"],
] as const;

type NavTitleKey = (typeof routes)[number][1];
type Translate<Key extends string> = (key: Key) => string;

/** Navigation context for the existing mobile header; page content keeps its own heading. */
export function getMobilePageTitle(
  pathname: string,
  translate: {
    nav: Translate<NavTitleKey>;
    breadcrumbs: Translate<"home" | "settings">;
    scanner: Translate<"title">;
  },
): string {
  const matches = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (pathname === "/" || matches("/dashboard")) return translate.breadcrumbs("home");
  if (matches("/dev/scanner-test")) return translate.scanner("title");
  const route = routes.find(([prefix]) => matches(prefix));
  if (route) return translate.nav(route[1]);
  if (matches("/settings")) return translate.breadcrumbs("settings");
  // An unknown page already has its own heading. Do not repeat the brand as its title.
  return "";
}
