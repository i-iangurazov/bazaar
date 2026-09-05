import { resolveBaamPageContext, type BaamPageContext } from "@/lib/baamNavigation";

/** Route references are hints only; the server authorizes every product lookup. */
export type BaamUiPageContext = { kind: "product"; id: string } | { kind: "section"; section: BaamPageContext };
export function getBaamUiPageContext(pathname: string | null): BaamUiPageContext {
  const section = resolveBaamPageContext(pathname);
  const path = (pathname ?? "").split(/[?#]/, 1)[0].replace(/^\/(en|ru|kg)(?=\/|$)/, "");
  const match = /^\/products\/([^/]+)\/?$/.exec(path);
  if (section === "products" && match && match[1] !== "new") {
    try {
      const id = decodeURIComponent(match[1]);
      if (/^[A-Za-z0-9_-]{1,128}$/.test(id)) return { kind: "product", id };
    } catch { /* Malformed route references remain a section hint. */ }
  }
  return { kind: "section", section };
}

const contextualPrompts: Partial<Record<BaamPageContext, [string, string]>> = {
  customers: ["customers", "customersPrompt"], suppliers: ["suppliers", "suppliersPrompt"],
  stores: ["stores", "storesPrompt"], imports: ["imports", "importsPrompt"],
  integrations: ["integrations", "integrationsPrompt"], settings: ["profile", "settingsPrompt"],
  support: ["help", "helpPrompt"], reports: ["analytics", "reportPrompt"],
};

export function baamStarterKeys(context: BaamUiPageContext, navigationIds: readonly string[] = []) {
  if (context.kind === "product") return ["productDetailsPrompt", "productPerformancePrompt", "capabilitiesPrompt"];
  if (context.section === "products") return ["topProductsPrompt", "bottomProductsPrompt", "zeroProductsPrompt"];
  const contextual = contextualPrompts[context.section];
  if (contextual && navigationIds.includes(contextual[0])) return [contextual[1], "briefPrompt", "capabilitiesPrompt"];
  if (context.section === "sales" || context.section === "reports") return ["changePrompt", "nextPrompt", "topProductsPrompt"];
  return ["briefPrompt", "topProductsPrompt", "capabilitiesPrompt"];
}

export function baamPageLabelKey(context: BaamUiPageContext) {
  if (context.kind === "product") return "pageProduct";
  const keys: Partial<Record<BaamPageContext, string>> = {
    products: "pageCatalog", customers: "pageCustomers", suppliers: "pageSuppliers", stores: "pageStores",
    sales: "pageSales", reports: "pageReports", imports: "pageImports", integrations: "pageIntegrations",
    settings: "pageSettings", support: "pageHelp",
  };
  return keys[context.section] ?? "pageOverview";
}
