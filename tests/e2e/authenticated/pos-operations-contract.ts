import { authenticatedE2EIds, authenticatedE2ESeedPrefix } from "./contract";

const productUnitPriceKgs = 120;
const cashSaleQuantity = 2;
const returnQuantity = 1;
const debtSaleQuantity = 1;
const openingCashKgs = 100;
const cashPayInKgs = 30;
const cashPayOutKgs = 20;

export const authenticatedPosOperationsFixture = {
  organizationId: authenticatedE2EIds.primaryOrganization,
  storeId: authenticatedE2EIds.primaryStore,
  baseUnitId: authenticatedE2EIds.primaryUnit,
  adminUserId: "qa_bazaar_auth_user_admin",
  foreignOrganizationId: authenticatedE2EIds.secondOrganization,
  foreignStoreId: authenticatedE2EIds.secondTenantStore,
  foreignAdminUserId: "qa_bazaar_auth_user_second_tenant_admin",
  idempotencyKeyPrefix: "qa-pos-ops-",
  paymentCorrection: {
    idempotencyKeyPrefix: "qa-pos-payment-correction-",
    eligibleRegister: {
      id: "qa_bazaar_pos_payment_correction_register",
      name: `${authenticatedE2ESeedPrefix} Payment Correction Register`,
      code: "QA-POS-PAY-CORR",
    },
    eligibleShiftId: "qa_bazaar_pos_payment_correction_shift",
    eligibleReceipt: {
      id: "qa_bazaar_pos_payment_correction_eligible",
      lineId: "qa_bazaar_pos_payment_correction_eligible_line",
      paymentId: "qa_bazaar_pos_payment_correction_eligible_payment",
      number: "S-006065",
      totalKgs: 4_100,
      createdAt: "2026-08-31T02:08:00.000Z",
      completedAt: "2026-08-31T05:23:00.000Z",
    },
    ineligibleRegister: {
      id: "qa_bazaar_pos_payment_locked_register",
      name: `${authenticatedE2ESeedPrefix} Locked Payment Register`,
      code: "QA-POS-PAY-LOCKED",
    },
    ineligibleShiftId: "qa_bazaar_pos_payment_locked_shift",
    ineligibleReceipt: {
      id: "qa_bazaar_pos_payment_correction_ineligible",
      lineId: "qa_bazaar_pos_payment_correction_ineligible_line",
      paymentId: "qa_bazaar_pos_payment_correction_ineligible_payment",
      number: "S-006072",
      totalKgs: 66_390,
      createdAt: "2026-08-31T02:06:00.000Z",
      completedAt: "2026-08-31T05:24:00.000Z",
    },
    reason: `${authenticatedE2ESeedPrefix} cashier selected cash instead of transfer`,
  },
  variantKey: "BASE",
  register: {
    id: "qa_bazaar_pos_operations_register",
    name: `${authenticatedE2ESeedPrefix} POS Operations Register`,
    code: "QA-POS-OPS",
  },
  shift: {
    id: "qa_bazaar_pos_operations_shift",
    openingCashKgs,
  },
  foreignRegister: {
    id: "qa_bazaar_pos_operations_foreign_register",
    name: `${authenticatedE2ESeedPrefix} Foreign POS Operations Register`,
    code: "QA-POS-OPS-F",
  },
  foreignShift: {
    id: "qa_bazaar_pos_operations_foreign_shift",
  },
  product: {
    id: "qa_bazaar_pos_operations_product",
    storeProductId: "qa_bazaar_pos_operations_store_product",
    snapshotId: "qa_bazaar_pos_operations_snapshot",
    productCostId: "qa_bazaar_pos_operations_cost",
    barcodeId: "qa_bazaar_pos_operations_barcode",
    name: `${authenticatedE2ESeedPrefix} POS Operations Product`,
    sku: `${authenticatedE2ESeedPrefix}-POS-OPS-001`,
    barcode: "9962026083102",
    unitPriceKgs: productUnitPriceKgs,
    unitCostKgs: 50,
    baselineOnHand: 30,
  },
  customer: {
    id: "qa_bazaar_pos_operations_customer",
    name: `${authenticatedE2ESeedPrefix} POS Operations Customer`,
    phone: "+996555260831",
  },
  debtCustomerName: `${authenticatedE2ESeedPrefix} POS Operations Debt Customer`,
  cashSaleQuantity,
  returnQuantity,
  debtSaleQuantity,
  cashSaleTotalKgs: productUnitPriceKgs * cashSaleQuantity,
  returnTotalKgs: productUnitPriceKgs * returnQuantity,
  debtSaleTotalKgs: productUnitPriceKgs * debtSaleQuantity,
  cash: {
    payInKgs: cashPayInKgs,
    payInReason: `${authenticatedE2ESeedPrefix} POS operations float`,
    payOutKgs: cashPayOutKgs,
    payOutComment: `${authenticatedE2ESeedPrefix} POS operations collection`,
  },
  expectedCashKgs:
    openingCashKgs +
    productUnitPriceKgs * cashSaleQuantity -
    productUnitPriceKgs * returnQuantity +
    productUnitPriceKgs * debtSaleQuantity +
    cashPayInKgs -
    cashPayOutKgs,
  countedCashKgs: 345,
  closingNote: `${authenticatedE2ESeedPrefix} verified five-som drawer shortage`,
  expectedFinalOnHand: 30 - cashSaleQuantity + returnQuantity - debtSaleQuantity,
} as const;
