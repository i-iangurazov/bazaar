import { authenticatedE2EIds } from "./contract";

export const authenticatedAccountingFixture = {
  organizationId: authenticatedE2EIds.primaryOrganization,
  storeId: authenticatedE2EIds.primaryStore,
  storeName: "QA-BAZAAR Primary Store",
  otherStoreId: authenticatedE2EIds.secondaryStore,
  otherStoreName: "QA-BAZAAR Secondary Store",
  baseUnitId: authenticatedE2EIds.primaryUnit,
  adminUserId: "qa_bazaar_auth_user_admin",
  variantKey: "BASE",
  weightedCostCases: [
    {
      key: "baseline",
      productId: "qa_bazaar_auth_accounting_product_baseline",
      productName: "QA-BAZAAR WAC Baseline 80.46",
      sku: "QA-BZR-WAC-8046",
      initialMovementId: "qa_bazaar_auth_accounting_initial_baseline",
      initialReferenceId: "qa_bazaar_auth_accounting_initial_ref_baseline",
      initialQuantity: 5,
      initialUnitCostKgs: 80.25,
      initialValueKgs: 401.25,
      initialAt: "2026-08-28T06:00:00.000Z",
      receiptMovementId: "qa_bazaar_auth_accounting_receipt_baseline",
      receiptReferenceId: "qa_bazaar_auth_accounting_receipt_ref_baseline",
      receiptQuantity: 2,
      receiptUnitCostKgs: 81,
      receiptValueKgs: 162,
      receiptAt: "2026-08-29T06:00:00.000Z",
      expectedQuantity: 7,
      expectedValueKgs: 563.25,
      expectedAverageCostKgs: 80.46,
    },
    {
      key: "master",
      productId: "qa_bazaar_auth_accounting_product_master",
      productName: "QA-BAZAAR WAC Master 80.90",
      sku: "QA-BZR-WAC-8090",
      initialMovementId: "qa_bazaar_auth_accounting_initial_master",
      initialReferenceId: "qa_bazaar_auth_accounting_initial_ref_master",
      initialQuantity: 5,
      initialUnitCostKgs: 80.2,
      initialValueKgs: 401,
      initialAt: "2026-08-28T06:01:00.000Z",
      receiptMovementId: "qa_bazaar_auth_accounting_receipt_master",
      receiptReferenceId: "qa_bazaar_auth_accounting_receipt_ref_master",
      receiptQuantity: 10,
      receiptUnitCostKgs: 81.25,
      receiptValueKgs: 812.5,
      receiptAt: "2026-08-29T06:01:00.000Z",
      expectedQuantity: 15,
      expectedValueKgs: 1213.5,
      expectedAverageCostKgs: 80.9,
    },
  ],
  shrinkage: {
    productId: "qa_bazaar_auth_accounting_product_shrinkage",
    productName: "QA-BAZAAR Posted Write-off",
    sku: "QA-BZR-WRITEOFF-8092",
    initialMovementId: "qa_bazaar_auth_accounting_initial_shrinkage",
    initialReferenceId: "qa_bazaar_auth_accounting_initial_ref_shrinkage",
    initialQuantity: 10,
    unitCostKgs: 80.46,
    initialValueKgs: 804.6,
    initialAt: "2026-08-29T06:00:00.000Z",
    movementId: "qa_bazaar_auth_accounting_write_off",
    referenceId: "qa_bazaar_auth_accounting_write_off_ref",
    quantity: 2,
    valueKgs: 160.92,
    remainingQuantity: 8,
    remainingValueKgs: 643.68,
    occurredAt: "2026-08-30T18:00:00.000Z",
    businessDate: "2026-08-31",
    reason: "Порча",
    comment: "QA-BAZAAR acceptance boundary write-off",
  },
} as const;

export type AuthenticatedWeightedCostCase =
  (typeof authenticatedAccountingFixture.weightedCostCases)[number];

export const weightedCostInitialDocumentPath = (fixture: AuthenticatedWeightedCostCase) => {
  const documentKey = `PRODUCT:Product:${fixture.initialReferenceId}`;
  return `/inventory/movements/${encodeURIComponent(documentKey)}`;
};

export const weightedCostReceiptDocumentPath = (fixture: AuthenticatedWeightedCostCase) => {
  const documentKey = `STOCK_RECEIVING:STOCK_RECEIVING:${fixture.receiptReferenceId}`;
  return `/inventory/movements/${encodeURIComponent(documentKey)}`;
};
