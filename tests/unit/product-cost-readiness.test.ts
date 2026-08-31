import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { resolveFrozenMovementCost } from "@/server/services/costReadModels";
import { resolveCurrentProductCostUnit } from "@/server/services/productCost";
import { classifyProductCostReconciliation } from "@/server/services/productCostReconciliation";

describe("precise ProductCost read model", () => {
  it("uses the six-decimal basis instead of the rounded average projection", () => {
    const unitCost = resolveCurrentProductCostUnit({
      avgCostKgs: new Prisma.Decimal("80.46"),
      costBasisQty: 3,
      costBasisValueKgs: new Prisma.Decimal("241.39"),
    });

    expect(Number(unitCost)).toBeCloseTo(80.4633333333, 8);
  });

  it("preserves legacy and zero-quantity manual/display costs", () => {
    expect(
      Number(
        resolveCurrentProductCostUnit({
          avgCostKgs: new Prisma.Decimal("80.46"),
          costBasisQty: 3,
          costBasisValueKgs: new Prisma.Decimal(0),
        }),
      ),
    ).toBe(80.46);
    expect(
      Number(
        resolveCurrentProductCostUnit({
          avgCostKgs: new Prisma.Decimal("92.35"),
          costBasisQty: 0,
          costBasisValueKgs: new Prisma.Decimal(0),
        }),
      ),
    ).toBe(92.35);
  });
});

describe("frozen movement COGS", () => {
  it("prefers the precise signed inventory value and derives its exact unit cost", () => {
    const cost = resolveFrozenMovementCost({
      qtyDelta: -3,
      unitCostKgs: new Prisma.Decimal("80.46"),
      lineTotalKgs: new Prisma.Decimal("-241.38"),
      inventoryValueDeltaKgs: new Prisma.Decimal("-241.39"),
    });

    expect(cost.totalCostKgs).toBe(-241.39);
    expect(cost.unitCostKgs).toBeCloseTo(80.4633333333, 8);
  });

  it("falls back only to values frozen on the movement", () => {
    expect(
      resolveFrozenMovementCost({
        qtyDelta: -2,
        unitCostKgs: new Prisma.Decimal(10),
        lineTotalKgs: null,
        inventoryValueDeltaKgs: null,
      }),
    ).toEqual({ unitCostKgs: 10, totalCostKgs: -20 });
    expect(
      resolveFrozenMovementCost({
        qtyDelta: -2,
        unitCostKgs: null,
        lineTotalKgs: null,
        inventoryValueDeltaKgs: null,
      }),
    ).toEqual({ unitCostKgs: null, totalCostKgs: null });
  });
});

describe("read-only ProductCost reconciliation classification", () => {
  it("identifies deterministic legacy basis backfill", () => {
    const result = classifyProductCostReconciliation({
      physicalQuantity: 3,
      ledgerQuantity: 3,
      ledgerValueKgs: "241.38",
      valuedMovementCount: 1,
      unvaluedMovementCount: 0,
      currentCost: {
        quantity: 3,
        basisValueKgs: 0,
        averageCostKgs: "80.46",
      },
    });

    expect(result).toMatchObject({
      status: "DETERMINISTIC_REPAIR",
      safeRepair: {
        action: "BACKFILL_LEGACY_BASIS_VALUE",
        quantity: 3,
        basisValueKgs: 241.38,
        averageCostKgs: 80.46,
      },
      reviewReasons: [],
    });
  });

  it("can propose creating a missing basis only from a complete ledger", () => {
    const result = classifyProductCostReconciliation({
      physicalQuantity: 4,
      ledgerQuantity: 4,
      ledgerValueKgs: "40.123456",
      valuedMovementCount: 2,
      unvaluedMovementCount: 0,
      currentCost: null,
    });

    expect(result).toMatchObject({
      status: "DETERMINISTIC_REPAIR",
      safeRepair: {
        action: "CREATE_FROM_COMPLETE_MOVEMENT_LEDGER",
        quantity: 4,
        basisValueKgs: 40.123456,
        averageCostKgs: 10.03,
      },
      reviewReasons: [],
    });
  });

  it("requires review for incomplete history and ambiguous revaluation", () => {
    const incomplete = classifyProductCostReconciliation({
      physicalQuantity: 5,
      ledgerQuantity: 5,
      ledgerValueKgs: "40",
      valuedMovementCount: 1,
      unvaluedMovementCount: 1,
      currentCost: {
        quantity: 5,
        basisValueKgs: 50,
        averageCostKgs: 10,
      },
    });
    expect(incomplete.status).toBe("REVIEW_REQUIRED");
    expect(incomplete.reviewReasons).toContain("UNVALUED_MOVEMENT_HISTORY");

    const revalued = classifyProductCostReconciliation({
      physicalQuantity: 5,
      ledgerQuantity: 5,
      ledgerValueKgs: "40",
      valuedMovementCount: 2,
      unvaluedMovementCount: 0,
      currentCost: {
        quantity: 5,
        basisValueKgs: 50,
        averageCostKgs: 10,
      },
    });
    expect(revalued.status).toBe("REVIEW_REQUIRED");
    expect(revalued.reviewReasons).toContain("CURRENT_VALUE_DIFFERS_FROM_LEDGER");
    expect(revalued.safeRepair).toBeNull();
  });

  it("retains a cost-only display value when no inventory remains", () => {
    expect(
      classifyProductCostReconciliation({
        physicalQuantity: 0,
        ledgerQuantity: 0,
        ledgerValueKgs: 0,
        valuedMovementCount: 2,
        unvaluedMovementCount: 0,
        currentCost: {
          quantity: 0,
          basisValueKgs: 0,
          averageCostKgs: "92.35",
        },
      }),
    ).toMatchObject({ status: "MATCH", safeRepair: null, reviewReasons: [] });
  });
});
