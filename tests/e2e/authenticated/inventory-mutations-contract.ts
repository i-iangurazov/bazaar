import { authenticatedE2EIds, authenticatedE2ESeedPrefix } from "./contract";

const product = (
  key: string,
  name: string,
  sku: string,
  primaryOnHand: number,
  secondaryOnHand = 0,
) => ({
  id: `qa_bazaar_mutation_product_${key}`,
  storeProductId: `qa_bazaar_mutation_store_product_${key}`,
  secondaryStoreProductId: `qa_bazaar_mutation_store_product_${key}_secondary`,
  primarySnapshotId: `qa_bazaar_mutation_snapshot_${key}`,
  secondarySnapshotId: `qa_bazaar_mutation_snapshot_${key}_secondary`,
  productCostId: `qa_bazaar_mutation_product_cost_${key}`,
  name: `${authenticatedE2ESeedPrefix} ${name}`,
  sku: `${authenticatedE2ESeedPrefix}-${sku}`,
  primaryOnHand,
  secondaryOnHand,
  unitCostKgs: 50,
});

export const authenticatedInventoryMutationFixture = {
  organizationId: authenticatedE2EIds.primaryOrganization,
  primaryStoreId: authenticatedE2EIds.primaryStore,
  secondaryStoreId: authenticatedE2EIds.secondaryStore,
  baseUnitId: authenticatedE2EIds.primaryUnit,
  supplierId: authenticatedE2EIds.primarySupplier,
  adminUserId: "qa_bazaar_auth_user_admin",
  guidanceToursDisabledMarker: "__guidance:tours_disabled__",
  variantKey: "BASE",
  adjustment: product("adjustment", "Mutation Adjustment Product", "MUT-ADJUST", 20),
  receiving: product("receiving", "Mutation Receiving Product", "MUT-RECEIVE", 20),
  transfer: product("transfer", "Mutation Transfer Product", "MUT-TRANSFER", 20, 10),
  writeOff: product("write_off", "Mutation Write-off Product", "MUT-WRITE-OFF", 20),
  mobile: product("mobile", "Mutation Mobile Product", "MUT-MOBILE", 20),
  stockCount: {
    ...product("stock_count", "Mutation Stock-count Product", "MUT-COUNT", 20),
    countId: "qa_bazaar_mutation_stock_count",
    countLineId: "qa_bazaar_mutation_stock_count_line",
    code: `${authenticatedE2ESeedPrefix}-MUT-COUNT-1`,
    countedQty: 24,
  },
} as const;

export const authenticatedInventoryMutationProducts = [
  authenticatedInventoryMutationFixture.adjustment,
  authenticatedInventoryMutationFixture.receiving,
  authenticatedInventoryMutationFixture.transfer,
  authenticatedInventoryMutationFixture.writeOff,
  authenticatedInventoryMutationFixture.mobile,
  authenticatedInventoryMutationFixture.stockCount,
] as const;
