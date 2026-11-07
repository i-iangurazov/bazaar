import type { PlanFeature } from "@/lib/billing/plans";

// Shared by RPC authorization and the coverage audit. Service/direct HTTP
// entry points also enforce their feature at the operation boundary.
export function requiredPlanFeature(path: string): PlanFeature | null {
  const [area, operation] = path.split(".");
  const areaFeature: Partial<Record<string, PlanFeature>> = {
    priceBooks: "priceBooks",
    purchaseOrders: "purchaseOrders",
    forecast: "replenishment",
    stockLots: "expiryLots",
    bundles: "bundles",
    bazaarApi: "bazaarApi",
    productImageStudio: "imageStudio",
    mMarket: "marketplaces",
    oMarket: "marketplaces",
  };
  if (areaFeature[area]) return areaFeature[area]!;
  if (area === "periodClose") return operation === "close" ? "periodClose" : null;
  if (area === "bazaarCatalog")
    return ["apiKeys", "createApiKey", "revokeApiKey"].includes(operation)
      ? "bazaarApi"
      : "bazaarCatalog";
  if (area === "bakaiStore")
    return [
      "apiPreflight",
      "apiSyncNow",
      "apiSyncReadyNow",
      "revealToken",
      "testConnection",
    ].includes(operation)
      ? "marketplaces"
      : "bakaiExport";
  if (area === "emailMarketing") {
    if (["automations", "updateAutomation", "testAutomation"].includes(operation))
      return "marketingAutomation";
    if (["createSender", "checkSenderDomain"].includes(operation)) return "ownSender";
    return "emailMarketing";
  }
  if (area === "loyalty" && !["posStatus", "orderSummary", "customerHistory"].includes(operation))
    return "loyalty";
  if (area === "products") {
    if (
      [
        "bulkGenerateDescriptions",
        "startDescriptionGenerationJob",
        "retryDescriptionGenerationJobFailed",
      ].includes(operation)
    )
      return "bulkAiContent";
    // The category operation also serves single-cell editing; its service gates
    // multiple IDs so an ordinary category edit remains part of the base plan.
    if (
      [
        "duplicateReview",
        "duplicateDiagnostics",
        "bulkGenerateBarcodes",
        "arrangeClothingCategories",
      ].includes(operation)
    )
      return "bulkProducts";
    if (
      [
        "assignToStore",
        "previewStorePreparation",
        "applyStorePreparation",
        "reconcileStorePreparation",
      ].includes(operation)
    )
      return "assortments";
  }
  if (
    area === "stores" &&
    [
      "catalogSettings",
      "catalogProducts",
      "previewCatalogSettings",
      "saveCatalogSettings",
      "catalogSettingsHistory",
      "assortmentOverview",
      "assortmentSourceProducts",
      "assortmentHistory",
      "previewAssortmentShare",
      "applyAssortmentShare",
    ].includes(operation)
  )
    return "assortments";
  if (
    area === "storePrices" &&
    ["previewDiscount", "applyDiscount", "removeDiscount", "bulkUpdate"].includes(operation)
  )
    return "priceBooks";
  if (area === "customers" && ["previewImport", "importRows"].includes(operation)) return "imports";
  if (
    area === "inventory" &&
    [
      "transfer",
      "transferAssortmentOptions",
      "previewTransferAssortment",
      "applyTransferAssortment",
      "reconcileTransferAssortment",
    ].includes(operation)
  )
    return "assortments";
  return null;
}
