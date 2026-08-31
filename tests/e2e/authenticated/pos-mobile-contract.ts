import { authenticatedE2EIds, authenticatedE2ESeedPrefix } from "./contract";

export const authenticatedPosMobileFixture = {
  organizationId: authenticatedE2EIds.primaryOrganization,
  storeId: authenticatedE2EIds.primaryStore,
  registerId: authenticatedE2EIds.primaryRegister,
  shiftId: authenticatedE2EIds.primaryShift,
  baseUnitId: authenticatedE2EIds.primaryUnit,
  adminUserId: "qa_bazaar_auth_user_admin",
  variantKey: "BASE",
  customer: {
    id: authenticatedE2EIds.primaryCustomer,
    name: `${authenticatedE2ESeedPrefix} Authenticated Customer`,
  },
  product: {
    id: "qa_bazaar_pos_mobile_product",
    storeProductId: "qa_bazaar_pos_mobile_store_product",
    snapshotId: "qa_bazaar_pos_mobile_snapshot",
    productCostId: "qa_bazaar_pos_mobile_cost",
    barcodeId: "qa_bazaar_pos_mobile_barcode",
    name: `${authenticatedE2ESeedPrefix} POS Mobile Product`,
    sku: `${authenticatedE2ESeedPrefix}-POS-MOBILE-001`,
    barcode: "9962026083101",
    basePriceKgs: 137.25,
    unitCostKgs: 61.5,
    baselineOnHand: 20,
    saleQuantity: 2,
  },
  discountKgs: 10.25,
  payments: {
    cashKgs: 100,
    cardKgs: 164.25,
  },
} as const;
