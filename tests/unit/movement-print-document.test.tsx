// @vitest-environment jsdom

import React from "react";
import { render, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  MovementPrintDocument,
  type MovementPrintDocumentLabels,
} from "@/components/inventory/movement-print-document";
import { formatCurrencyKGS, formatNumber } from "@/lib/i18nFormat";
import type { ProductMovementDocumentDetail } from "@/server/services/productMovements";

beforeAll(() => {
  vi.stubGlobal("React", React);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const labels: MovementPrintDocumentLabels = {
  companyFallback: "Bazaar",
  documentNumber: "Document #TRF-1",
  date: "Date",
  status: "Status",
  sourceStore: "Source store",
  destinationStore: "Destination store",
  receivingStore: "Receiving store",
  writeOffStore: "Write-off store",
  sender: "Sender",
  author: "Author",
  reason: "Reason",
  comment: "Comment",
  product: "Product",
  store: "Store",
  skuBarcode: "SKU / barcode",
  unit: "Unit",
  quantity: "Qty",
  unitCost: "Price",
  lineTotal: "Total",
  positions: "Positions",
  amount: "Amount",
  costNotSpecified: "not specified",
  shippedBy: "Shipped",
  releasedBy: "Released",
  writtenOffBy: "Written off",
  receivedBy: "Received",
  checkedBy: "Checked",
  responsible: "Responsible",
  signatureDate: "Date",
  notAvailable: "-",
  statusLabel: "Posted",
  title: "Store transfer",
};

const transferDocument: ProductMovementDocumentDetail = {
  id: "TRANSFER:TRANSFER:transfer-1",
  documentId: "transfer-1",
  documentType: "TRANSFER",
  documentNumber: "TRF-1",
  isPosSale: null,
  documentLabel: "Transfer",
  organizationName: "Bazaar Test",
  createdAt: new Date("2026-08-31T06:00:00.000Z"),
  postedAt: new Date("2026-08-31T06:00:00.000Z"),
  status: "POSTED",
  paymentStatus: "NOT_APPLICABLE",
  orderStatus: null,
  senderName: "Airport Store",
  recipientName: "Downtown Store",
  storeName: null,
  authorName: "Audit Operator",
  authorEmail: "audit@example.com",
  positionsCount: 1,
  totalQuantity: 5,
  totalAmount: 500,
  paidAmount: null,
  reason: null,
  comment: "Balanced transfer",
  description: null,
  detailUrl: null,
  sourceStoreId: "store-source",
  destinationStoreId: "store-destination",
  lines: [
    {
      id: "transfer-out",
      productId: "product-1",
      variantId: null,
      storeId: "store-source",
      productDetailUrl: "/products/product-1?storeId=store-source",
      storeName: "Airport Store",
      productName: "Audit Tea",
      sku: "AUDIT-TEA",
      barcode: "100000000001",
      unit: "pcs",
      variantName: null,
      movementType: "TRANSFER_OUT",
      qtyDelta: -5,
      linePosition: 1,
      unitCostKgs: 100,
      lineTotalKgs: 500,
      note: "Balanced transfer",
      createdAt: new Date("2026-08-31T06:00:00.000Z"),
      authorName: "Audit Operator",
      authorEmail: "audit@example.com",
    },
    {
      id: "transfer-in",
      productId: "product-1",
      variantId: null,
      storeId: "store-destination",
      productDetailUrl: "/products/product-1?storeId=store-destination",
      storeName: "Downtown Store",
      productName: "Audit Tea",
      sku: "AUDIT-TEA",
      barcode: "100000000001",
      unit: "pcs",
      variantName: null,
      movementType: "TRANSFER_IN",
      qtyDelta: 5,
      linePosition: 1,
      unitCostKgs: 100,
      lineTotalKgs: 500,
      note: "Balanced transfer",
      createdAt: new Date("2026-08-31T06:00:00.000Z"),
      authorName: "Audit Operator",
      authorEmail: "audit@example.com",
    },
  ],
};

describe("MovementPrintDocument", () => {
  it("renders one signed, valued leg for each store and balanced transfer totals", () => {
    const { container } = render(
      <MovementPrintDocument document={transferDocument} labels={labels} locale="en" />,
    );

    const table = container.querySelector(".movement-print-table");
    expect(table).not.toBeNull();
    const bodyRows = within(table as HTMLTableElement)
      .getAllByRole("row")
      .slice(1);
    expect(bodyRows).toHaveLength(2);

    const sourceRows = bodyRows.filter((row) => row.textContent?.includes("Airport Store"));
    const destinationRows = bodyRows.filter((row) => row.textContent?.includes("Downtown Store"));
    expect(sourceRows).toHaveLength(1);
    expect(destinationRows).toHaveLength(1);

    expect(sourceRows[0]?.querySelector(".movement-print-store")?.textContent).toContain(
      "Source store",
    );
    expect(sourceRows[0]?.querySelector(".movement-print-qty")?.textContent).toBe(
      formatNumber(-5, "en"),
    );
    expect(sourceRows[0]?.querySelector("[data-movement-line-value]")?.textContent).toBe(
      formatCurrencyKGS(-500, "en"),
    );

    expect(destinationRows[0]?.querySelector(".movement-print-store")?.textContent).toContain(
      "Destination store",
    );
    expect(destinationRows[0]?.querySelector(".movement-print-qty")?.textContent).toBe(
      formatNumber(5, "en"),
    );
    expect(destinationRows[0]?.querySelector("[data-movement-line-value]")?.textContent).toBe(
      formatCurrencyKGS(500, "en"),
    );

    const totals = Array.from(container.querySelectorAll(".movement-print-total-row"));
    expect(totals.map((row) => row.textContent)).toEqual([
      `Positions${formatNumber(1, "en")}`,
      `Qty${formatNumber(0, "en")}`,
      `Amount${formatCurrencyKGS(0, "en")}`,
    ]);
  });
});
