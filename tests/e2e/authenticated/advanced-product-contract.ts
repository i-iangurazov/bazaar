import { authenticatedE2EIds, authenticatedE2ESeedPrefix } from "./contract";

const seededProduct = (key: string, label: string, sku: string) => ({
  id: `qa_bazaar_advanced_product_${key}`,
  storeProductId: `qa_bazaar_advanced_store_product_${key}`,
  name: `${authenticatedE2ESeedPrefix} ${label}`,
  sku: `${authenticatedE2ESeedPrefix}-${sku}`,
});

export const authenticatedAdvancedProductFixture = {
  organizationId: authenticatedE2EIds.primaryOrganization,
  storeId: authenticatedE2EIds.primaryStore,
  baseUnitId: authenticatedE2EIds.primaryUnit,
  adminUserId: "qa_bazaar_auth_user_admin",
  variantKey: "BASE",
  component: {
    ...seededProduct("component", "Advanced Bundle Component", "ADV-COMPONENT"),
    snapshotId: "qa_bazaar_advanced_snapshot_component",
    productCostId: "qa_bazaar_advanced_cost_component",
    onHand: 20,
    unitCostKgs: 25,
  },
  staleEdit: {
    ...seededProduct("stale", "Advanced Stale Edit", "ADV-STALE"),
    winnerName: `${authenticatedE2ESeedPrefix} Advanced Stale Winner`,
    loserName: `${authenticatedE2ESeedPrefix} Advanced Stale Loser`,
  },
  image: seededProduct("image", "Advanced Product Image", "ADV-IMAGE"),
  browserBundle: {
    name: `${authenticatedE2ESeedPrefix} Browser Advanced Bundle`,
    sku: `${authenticatedE2ESeedPrefix}-ADV-BROWSER-BUNDLE`,
    createComponentQty: 3,
    editedComponentQty: 4,
    assembleQty: 2,
  },
  invalidImport: {
    fileName: "qa-bazaar-invalid-products.csv",
    sku: `${authenticatedE2ESeedPrefix}-ADV-INVALID-IMPORT`,
  },
} as const;

export const authenticatedAdvancedSeededProducts = [
  authenticatedAdvancedProductFixture.component,
  authenticatedAdvancedProductFixture.staleEdit,
  authenticatedAdvancedProductFixture.image,
] as const;
