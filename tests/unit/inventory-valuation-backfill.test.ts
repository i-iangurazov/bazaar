import { describe, expect, it } from "vitest";

import { classifyInventoryMovementEvidence } from "@/server/services/inventoryValuationBackfill";
import {
  type InventoryValuationBackfillCliError,
  parseInventoryValuationBackfillCliOptions,
} from "../../scripts/inventory-valuation-backfill";

describe("inventory valuation backfill evidence classification", () => {
  it("uses explicit receipt, write-off, frozen-document, and paired-transfer evidence", () => {
    expect(
      classifyInventoryMovementEvidence({
        type: "RECEIVE",
        qtyDelta: 3,
        unitCostKgs: 5,
        lineTotalKgs: null,
        note: null,
        referenceType: null,
      }),
    ).toMatchObject({
      outcome: "VALUE",
      valueKgs: "15.000000",
      reason: "RECEIPT_COST_EVIDENCE",
    });
    expect(
      classifyInventoryMovementEvidence({
        type: "WRITE_OFF",
        qtyDelta: -2,
        unitCostKgs: 10,
        lineTotalKgs: 20,
        note: null,
        referenceType: "WRITE_OFF",
      }),
    ).toMatchObject({ outcome: "VALUE", valueKgs: "-20.000000" });
    expect(
      classifyInventoryMovementEvidence({
        type: "SALE",
        qtyDelta: -4,
        unitCostKgs: null,
        lineTotalKgs: null,
        note: null,
        referenceType: "CustomerOrder",
        linkedFrozenCostKgs: 32,
      }),
    ).toMatchObject({ outcome: "VALUE", valueKgs: "-32.000000" });
    expect(
      classifyInventoryMovementEvidence({
        type: "TRANSFER_IN",
        qtyDelta: 2,
        unitCostKgs: null,
        lineTotalKgs: null,
        note: null,
        referenceType: "TRANSFER",
        pairedTransferValueKgs: -18,
      }),
    ).toMatchObject({ outcome: "VALUE", valueKgs: "18.000000" });
  });

  it("never invents ambiguous or unaudited zero-cost values", () => {
    expect(
      classifyInventoryMovementEvidence({
        type: "ADJUSTMENT",
        qtyDelta: 2,
        unitCostKgs: null,
        lineTotalKgs: null,
        note: null,
        referenceType: null,
      }),
    ).toEqual({
      outcome: "REVIEW",
      valueKgs: null,
      status: "REVIEW_REQUIRED",
      reason: "UNSUPPORTED_MOVEMENT_EVIDENCE",
    });
    expect(
      classifyInventoryMovementEvidence({
        type: "RECEIVE",
        qtyDelta: 1,
        unitCostKgs: 0,
        lineTotalKgs: 0,
        note: "legacy zero",
        referenceType: null,
      }),
    ).toMatchObject({ outcome: "REVIEW", reason: "POSITIVE_ZERO_WITHOUT_AUDIT_REASON" });
    expect(
      classifyInventoryMovementEvidence({
        type: "RECEIVE",
        qtyDelta: 1,
        unitCostKgs: 0,
        lineTotalKgs: 0,
        note: "legacy zero • [ZERO_COST_REASON] approved donation",
        referenceType: null,
      }),
    ).toMatchObject({ outcome: "VALUE", status: "EXPLICIT_ZERO", valueKgs: "0.000000" });
    expect(
      classifyInventoryMovementEvidence({
        type: "TRANSFER_OUT",
        qtyDelta: -2,
        unitCostKgs: null,
        lineTotalKgs: null,
        existingInventoryValueKgs: -18,
        note: null,
        referenceType: "TRANSFER",
      }),
    ).toMatchObject({ outcome: "REVIEW", reason: "PAIRED_TRANSFER_COST_EVIDENCE" });
    expect(
      classifyInventoryMovementEvidence({
        type: "RECEIVE",
        qtyDelta: 1,
        unitCostKgs: "1000000000000",
        lineTotalKgs: null,
        note: null,
        referenceType: "STOCK_RECEIVING",
      }),
    ).toMatchObject({ outcome: "REVIEW", reason: "VALUE_STORAGE_OVERFLOW" });
  });

  it("classifies quantity-neutral rows without manufacturing stock value", () => {
    expect(
      classifyInventoryMovementEvidence({
        type: "ADJUSTMENT",
        qtyDelta: 0,
        unitCostKgs: null,
        lineTotalKgs: null,
        note: null,
        referenceType: null,
      }),
    ).toMatchObject({ outcome: "NOT_APPLICABLE", valueKgs: "0.000000" });
    expect(
      classifyInventoryMovementEvidence({
        type: "RECEIVE",
        qtyDelta: 0,
        unitCostKgs: null,
        lineTotalKgs: -7.5,
        note: null,
        referenceType: "STOCK_RECEIVING",
      }),
    ).toMatchObject({ outcome: "VALUE", valueKgs: "-7.500000" });
  });

  it("requires explicit bounded write and writer-drain confirmations", () => {
    expect(
      parseInventoryValuationBackfillCliOptions([
        "--",
        "--dry-run",
        "--run-id=release-dry-run",
        "--batch-size=25",
        "--max-batches=4",
      ]),
    ).toEqual({
      mode: "dry-run",
      runId: "release-dry-run",
      organizationId: undefined,
      batchSize: 25,
      maxBatches: 4,
      writerDrainEvidence: undefined,
    });
    expect(() =>
      parseInventoryValuationBackfillCliOptions(
        [
          "--write",
          "--run-id=release-write",
          "--batch-size=100",
          "--confirm-write=BACKFILL_INVENTORY_VALUATION",
          "--confirm-writers-drained",
          "--writer-drain-evidence=all old deployment writers drained",
        ],
        {},
      ),
    ).toThrow(
      expect.objectContaining<Partial<InventoryValuationBackfillCliError>>({
        safeCode: "WRITE_ENV_FLAG_REQUIRED",
      }),
    );
    expect(
      parseInventoryValuationBackfillCliOptions(
        [
          "--write",
          "--run-id=release-write",
          "--organization-id=org-safe-scope",
          "--confirm-write=BACKFILL_INVENTORY_VALUATION",
          "--confirm-writers-drained",
          "--writer-drain-evidence=all old deployment writers drained",
        ],
        { ALLOW_INVENTORY_VALUATION_BACKFILL_WRITE: "1" },
      ),
    ).toMatchObject({
      mode: "write",
      runId: "release-write",
      batchSize: 100,
      writerDrainEvidence: "all old deployment writers drained",
    });
    expect(() =>
      parseInventoryValuationBackfillCliOptions([
        "--dry-run",
        "--run-id=invalid-dry-run",
        "--writer-drain-evidence=must not be accepted in dry run",
      ]),
    ).toThrow(
      expect.objectContaining<Partial<InventoryValuationBackfillCliError>>({
        safeCode: "DRY_RUN_WRITE_CONFIRMATION_FORBIDDEN",
      }),
    );
  });
});
