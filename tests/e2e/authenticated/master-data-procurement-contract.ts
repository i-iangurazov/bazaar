import { authenticatedE2EIds, authenticatedE2ESeedPrefix } from "./contract";

const catalogProduct = (index: number) => {
  const ordinal = String(index + 1).padStart(2, "0");
  return {
    id: `qa_bazaar_master_product_${ordinal}`,
    name: `${authenticatedE2ESeedPrefix} Master Product ${ordinal}`,
    sku: `${authenticatedE2ESeedPrefix}-MASTER-${ordinal}`,
    basePriceKgs: 100 + index,
  };
};

export const authenticatedMasterDataProcurementProducts = Array.from({ length: 26 }, (_, index) =>
  catalogProduct(index),
);

export const authenticatedMasterDataProcurementFixture = {
  organizationId: authenticatedE2EIds.primaryOrganization,
  storeId: authenticatedE2EIds.primaryStore,
  storeName: `${authenticatedE2ESeedPrefix} Primary Store`,
  baseUnitId: authenticatedE2EIds.primaryUnit,
  adminUserId: "qa_bazaar_auth_user_admin",
  category: {
    id: "qa_bazaar_master_category",
    name: `${authenticatedE2ESeedPrefix} Master Category`,
    normalizedName: `${authenticatedE2ESeedPrefix} Master Category`.toLocaleLowerCase("ru-RU"),
  },
  supplier: {
    id: "qa_bazaar_master_supplier",
    name: `${authenticatedE2ESeedPrefix} Master Supplier`,
    email: "qa-bazaar-master-supplier@auth-e2e.test",
    phone: "+996 555 900 100",
  },
  attribute: {
    id: "qa_bazaar_master_attribute",
    key: "qa_bazaar_master_attribute",
    labelRu: `${authenticatedE2ESeedPrefix} характеристика`,
    labelKg: `${authenticatedE2ESeedPrefix} кыргыз мүнөздөмөсү`,
    variantId: "qa_bazaar_master_attribute_variant",
    valueId: "qa_bazaar_master_attribute_value",
    value: `${authenticatedE2ESeedPrefix} кыргыз мааниси`,
    productId: authenticatedMasterDataProcurementProducts[25]!.id,
  },
  cancelProduct: {
    ...authenticatedMasterDataProcurementProducts[0]!,
    baselineOnHand: 7,
    unitCostKgs: 35,
  },
  receiveProduct: {
    ...authenticatedMasterDataProcurementProducts[1]!,
    baselineOnHand: 8,
    unitCostKgs: 40,
    purchaseQty: 3,
    purchaseUnitCostKgs: 52.5,
  },
  variantKey: "BASE",
} as const;
