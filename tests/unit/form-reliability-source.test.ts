import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const customerSource = readFileSync("src/app/(app)/customers/page.tsx", "utf8");
const supplierSource = readFileSync("src/app/(app)/suppliers/page.tsx", "utf8");
const purchaseOrderSource = readFileSync("src/app/(app)/purchase-orders/new/page.tsx", "utf8");
const purchaseOrderRouterSource = readFileSync("src/server/trpc/routers/purchaseOrders.ts", "utf8");

describe("high-risk form reliability source", () => {
  it("warns before discarding dirty customer and supplier dialogs or refreshing them", () => {
    for (const source of [customerSource, supplierSource]) {
      expect(source).toContain('window.addEventListener("beforeunload"');
      expect(source).toContain('tCommon("unsavedChangesConfirm")');
    }
    expect(customerSource).toContain("requestFormClose");
    expect(supplierSource).toContain("closeSupplierForm");
    expect(supplierSource).toContain("noValidate");
    expect(supplierSource).toContain("SUPPLIER_NOTES_MAX_LENGTH");
  });

  it("validates customer email locally and exposes an explicit retry action for read failures", () => {
    expect(customerSource).toContain("isValidOptionalCustomerEmail");
    expect(customerSource).toContain("customer-email-error");
    expect(customerSource).toContain("customersQuery.refetch()");
    expect(customerSource).toContain('tCommon("tryAgain")');
  });

  it("warns before abandoning a PO and enforces storage-safe quantity/cost bounds", () => {
    expect(purchaseOrderSource).toContain('window.addEventListener("beforeunload"');
    expect(purchaseOrderSource).toContain("cancelPurchaseOrderDraft");
    expect(purchaseOrderSource).toContain("normalizePurchaseOrderUnitCost");
    expect(purchaseOrderSource).toContain("calculatePurchaseOrderLineTotal");
    expect(purchaseOrderRouterSource).toContain("PURCHASE_ORDER_MAX_QUANTITY");
    expect(purchaseOrderRouterSource).toContain("PURCHASE_ORDER_MAX_UNIT_COST");
  });
});
