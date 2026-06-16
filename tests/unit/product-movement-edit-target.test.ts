import { describe, expect, it } from "vitest";

import { getProductMovementEditTarget } from "@/lib/productMovementEditTarget";

describe("product movement edit target", () => {
  it("routes inventory documents to native edit pages", () => {
    expect(
      getProductMovementEditTarget({
        id: "STOCK_RECEIVING:STOCK_RECEIVING:rcv_1",
        documentId: "rcv_1",
        documentType: "STOCK_RECEIVING",
        returnTo: "/inventory/movements",
      }).href,
    ).toBe(
      "/inventory/receiving/rcv_1/edit?from=movements&documentKey=STOCK_RECEIVING%3ASTOCK_RECEIVING%3Arcv_1&returnTo=%2Finventory%2Fmovements",
    );

    expect(
      getProductMovementEditTarget({
        id: "TRANSFER:TRANSFER:trn_1",
        documentId: "trn_1",
        documentType: "TRANSFER",
      }).href,
    ).toBe(
      "/inventory/transfers/trn_1/edit?from=movements&documentKey=TRANSFER%3ATRANSFER%3Atrn_1",
    );

    expect(
      getProductMovementEditTarget({
        id: "WRITE_OFF:WRITE_OFF:wo_1",
        documentId: "wo_1",
        documentType: "WRITE_OFF",
      }).href,
    ).toBe(
      "/inventory/write-offs/wo_1/edit?from=movements&documentKey=WRITE_OFF%3AWRITE_OFF%3Awo_1",
    );
  });

  it("routes POS receipts to the POS journal editor and non-POS orders to sales orders", () => {
    expect(
      getProductMovementEditTarget({
        id: "SALE:CustomerOrder:sale_1",
        documentId: "sale_1",
        documentType: "SALE",
        isPosSale: true,
      }).href,
    ).toBe("/pos/sell?receiptId=sale_1&mode=edit&from=movements");

    expect(
      getProductMovementEditTarget({
        id: "SALE:CustomerOrder:order_1",
        documentId: "order_1",
        documentType: "SALE",
        isPosSale: false,
      }).href,
    ).toBe("/sales/orders/order_1?from=movements");
  });

  it("routes counts and blocks unsupported edit types with reasons", () => {
    expect(
      getProductMovementEditTarget({
        id: "STOCK_COUNT:STOCK_COUNT:cnt_1",
        documentId: "cnt_1",
        documentType: "STOCK_COUNT",
      }).href,
    ).toBe("/inventory/counts/cnt_1?from=movements");

    expect(
      getProductMovementEditTarget({
        id: "RETURN:SaleReturn:ret_1",
        documentId: "ret_1",
        documentType: "RETURN",
      }).disabledReason,
    ).toBe("returnUnsupported");

    expect(
      getProductMovementEditTarget({
        id: "ADJUSTMENT:StockMovement:mov_1",
        documentId: "mov_1",
        documentType: "ADJUSTMENT",
      }).disabledReason,
    ).toBe("adjustmentUnsupported");
  });
});
