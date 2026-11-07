import type { PlanFeature } from "./plans";

const pages: Array<[string, PlanFeature]> = [
  ["/settings/price-lists", "priceBooks"],
  ["/settings/store-groups", "assortments"],
  ["/settings/loyalty", "loyalty"],
  ["/purchase-orders", "purchaseOrders"],
  ["/products/review", "bulkProducts"],
  ["/inventory/transfers", "assortments"],
  ["/reports/analytics", "analytics"],
  ["/reports/exports", "exports"],
  ["/operations/integrations/product-image-studio", "imageStudio"],
  ["/operations/integrations/email-marketing", "emailMarketing"],
  ["/operations/integrations/bazaar-catalog", "bazaarCatalog"],
  ["/operations/integrations/bazaar-api", "bazaarApi"],
  ["/operations/integrations/bakai-store", "bakaiExport"],
  ["/operations/integrations/m-market", "marketplaces"],
  ["/operations/integrations/o-market", "marketplaces"],
];
export const requiredPageFeature = (pathname: string): PlanFeature | null => {
  const path = pathname.replace(/^\/(?:ru|kg|ky|en)(?=\/)/, "");
  return pages.find(([prefix]) => path === prefix || path.startsWith(prefix + "/"))?.[1] ?? null;
};
