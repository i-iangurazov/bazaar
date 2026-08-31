import { describe, expect, it } from "vitest";

import {
  getMovementDocumentAmountKgs,
  getMovementDocumentLineValueKgs,
  hasMovementDocumentLineValues,
} from "@/lib/inventory/movementDocumentValue";

describe("movement document value presentation", () => {
  it("derives PRODUCT and ADJUSTMENT document amounts from valued movement lines", () => {
    const initialStockLine = {
      qtyDelta: 5,
      unitCostKgs: 80.25,
      lineTotalKgs: 401.25,
    };
    const negativeAdjustmentLine = {
      qtyDelta: -2,
      unitCostKgs: 80.46,
      lineTotalKgs: -160.92,
    };

    expect(hasMovementDocumentLineValues([initialStockLine])).toBe(true);
    expect(getMovementDocumentLineValueKgs("PRODUCT", initialStockLine)).toBe(401.25);
    expect(
      getMovementDocumentAmountKgs({
        documentType: "PRODUCT",
        totalAmount: null,
        lines: [initialStockLine],
      }),
    ).toBe(401.25);
    expect(
      getMovementDocumentAmountKgs({
        documentType: "ADJUSTMENT",
        totalAmount: null,
        lines: [negativeAdjustmentLine],
      }),
    ).toBe(-160.92);
  });

  it("keeps transfer legs signed while preserving the reconciled document amount", () => {
    const outgoing = { qtyDelta: -4, unitCostKgs: 80, lineTotalKgs: 320 };
    const incoming = { qtyDelta: 4, unitCostKgs: 80, lineTotalKgs: 320 };

    expect(getMovementDocumentLineValueKgs("TRANSFER", outgoing)).toBe(-320);
    expect(getMovementDocumentLineValueKgs("TRANSFER", incoming)).toBe(320);
    expect(
      getMovementDocumentAmountKgs({
        documentType: "TRANSFER",
        totalAmount: 320,
        lines: [outgoing, incoming],
      }),
    ).toBe(320);
    expect(
      getMovementDocumentAmountKgs({
        documentType: "TRANSFER",
        totalAmount: null,
        lines: [outgoing, incoming],
      }),
    ).toBe(0);
  });

  it("preserves receiving/write-off magnitudes and returns null without value evidence", () => {
    const receiving = { qtyDelta: 2, unitCostKgs: 81, lineTotalKgs: 162 };
    const writeOff = { qtyDelta: -2, unitCostKgs: 80.46, lineTotalKgs: 160.92 };
    const unvalued = { qtyDelta: 1, unitCostKgs: null, lineTotalKgs: null };

    expect(getMovementDocumentLineValueKgs("STOCK_RECEIVING", receiving)).toBe(162);
    expect(getMovementDocumentLineValueKgs("WRITE_OFF", writeOff)).toBe(160.92);
    expect(
      getMovementDocumentAmountKgs({
        documentType: "WRITE_OFF",
        totalAmount: 160.92,
        lines: [writeOff],
      }),
    ).toBe(160.92);
    expect(hasMovementDocumentLineValues([unvalued])).toBe(false);
    expect(
      getMovementDocumentAmountKgs({
        documentType: "OTHER",
        totalAmount: null,
        lines: [unvalued],
      }),
    ).toBeNull();
  });
});
