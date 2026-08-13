import { describe, expect, it } from "vitest";

import { resolveProductMovementDocumentViewTarget } from "@/lib/productMovementDocumentTarget";

const movement = (
  overrides: Partial<Parameters<typeof resolveProductMovementDocumentViewTarget>[0]> = {},
) => ({
  id: "ADJUSTMENT:StockMovement:movement_1",
  documentType: "ADJUSTMENT",
  documentReferenceType: "StockMovement",
  documentReferenceId: "movement_1",
  ...overrides,
});

describe("product movement document view target", () => {
  it("routes POS sales to the native receipt preview, never to Sales Orders", () => {
    expect(
      resolveProductMovementDocumentViewTarget(
        movement({
          id: "SALE:CustomerOrder:pos_sale_1",
          documentType: "SALE",
          documentReferenceType: "CustomerOrder",
          documentReferenceId: "pos_sale_1",
          isPosSale: true,
          sourceExists: true,
        }),
      ),
    ).toEqual({
      href: "/pos/receipts?receiptId=pos_sale_1",
      kind: "posReceipt",
      sourceMissing: false,
    });
  });

  it("routes non-POS CustomerOrders to Sales Orders", () => {
    expect(
      resolveProductMovementDocumentViewTarget(
        movement({
          id: "SALE:CustomerOrder:order_1",
          documentType: "SALE",
          documentReferenceType: "CustomerOrder",
          documentReferenceId: "order_1",
          isPosSale: false,
          sourceExists: true,
        }),
      ),
    ).toEqual({
      href: "/sales/orders/order_1",
      kind: "customerOrder",
      sourceMissing: false,
    });
  });

  it("routes receiving, transfer, write-off and adjustment to their preserved ledger views", () => {
    for (const [documentType, referenceType, referenceId] of [
      ["STOCK_RECEIVING", "STOCK_RECEIVING", "receiving_1"],
      ["TRANSFER", "TRANSFER", "transfer_1"],
      ["WRITE_OFF", "WRITE_OFF", "write_off_1"],
      ["ADJUSTMENT", "StockMovement", "adjustment_1"],
    ] as const) {
      const id = `${documentType}:${referenceType}:${referenceId}`;
      expect(
        resolveProductMovementDocumentViewTarget(
          movement({
            id,
            documentType,
            documentReferenceType: referenceType,
            documentReferenceId: referenceId,
          }),
        ),
      ).toEqual({
        href: `/inventory/movements/${encodeURIComponent(id)}`,
        kind: "movement",
        sourceMissing: false,
      });
    }
  });

  it("routes purchase orders and stock counts to their native details", () => {
    expect(
      resolveProductMovementDocumentViewTarget(
        movement({
          id: "PURCHASE_ORDER:PURCHASE_ORDER:po_1",
          documentType: "PURCHASE_ORDER",
          documentReferenceType: "PURCHASE_ORDER",
          documentReferenceId: "po_1",
          sourceExists: true,
        }),
      ).href,
    ).toBe("/purchase-orders/po_1");
    expect(
      resolveProductMovementDocumentViewTarget(
        movement({
          id: "STOCK_COUNT:STOCK_COUNT:count_1",
          documentType: "STOCK_COUNT",
          documentReferenceType: "STOCK_COUNT",
          documentReferenceId: "count_1",
          sourceExists: true,
        }),
      ).href,
    ).toBe("/inventory/counts/count_1");
  });

  it("routes POS returns back to the native receipt and non-POS returns to their order", () => {
    expect(
      resolveProductMovementDocumentViewTarget(
        movement({
          id: "RETURN:SaleReturn:return_1",
          documentType: "RETURN",
          documentReferenceType: "SaleReturn",
          documentReferenceId: "return_1",
          sourceExists: true,
          linkedCustomerOrderId: "pos_sale_1",
          linkedCustomerOrderIsPosSale: true,
        }),
      ).href,
    ).toBe("/pos/receipts?receiptId=pos_sale_1");

    expect(
      resolveProductMovementDocumentViewTarget(
        movement({
          id: "RETURN:SaleReturn:return_2",
          documentType: "RETURN",
          documentReferenceType: "SaleReturn",
          documentReferenceId: "return_2",
          sourceExists: true,
          linkedCustomerOrderId: "order_2",
          linkedCustomerOrderIsPosSale: false,
        }),
      ).href,
    ).toBe("/sales/orders/order_2");
  });

  it("keeps a missing historical source in the movement detail with an explicit missing state", () => {
    expect(
      resolveProductMovementDocumentViewTarget(
        movement({
          id: "SALE:CustomerOrder:deleted_sale",
          documentType: "SALE",
          documentReferenceType: "CustomerOrder",
          documentReferenceId: "deleted_sale",
          isPosSale: null,
          sourceExists: false,
        }),
      ),
    ).toEqual({
      href: "/inventory/movements/SALE%3ACustomerOrder%3Adeleted_sale?source=missing",
      kind: "movement",
      sourceMissing: true,
    });
  });
});
