import { describe, expect, it } from "vitest";

import { businessDateOnlyToUtc } from "@/lib/timezone";
import { authenticatedAccountingFixture } from "../e2e/authenticated/accounting-contract";

describe("authenticated accounting acceptance contract", () => {
  it("pins both weighted-average examples to their movement-derived quantity and value", () => {
    for (const fixture of authenticatedAccountingFixture.weightedCostCases) {
      const quantity = fixture.initialQuantity + fixture.receiptQuantity;
      const value = fixture.initialValueKgs + fixture.receiptValueKgs;
      const weightedAverage = Number((value / quantity).toFixed(2));

      expect(fixture.initialQuantity * fixture.initialUnitCostKgs).toBeCloseTo(
        fixture.initialValueKgs,
        6,
      );
      expect(fixture.receiptQuantity * fixture.receiptUnitCostKgs).toBeCloseTo(
        fixture.receiptValueKgs,
        6,
      );
      expect(quantity).toBe(fixture.expectedQuantity);
      expect(value).toBeCloseTo(fixture.expectedValueKgs, 6);
      expect(weightedAverage).toBe(fixture.expectedAverageCostKgs);
    }
  });

  it("pins the write-off to the inclusive Bishkek day boundary and exact inventory value", () => {
    const fixture = authenticatedAccountingFixture.shrinkage;

    expect(new Date(fixture.occurredAt)).toEqual(businessDateOnlyToUtc(fixture.businessDate));
    expect(fixture.quantity * fixture.unitCostKgs).toBeCloseTo(fixture.valueKgs, 6);
    expect(fixture.initialQuantity - fixture.quantity).toBe(fixture.remainingQuantity);
    expect(fixture.initialValueKgs - fixture.valueKgs).toBeCloseTo(fixture.remainingValueKgs, 6);
  });

  it("uses unique, visibly QA-owned fixed identifiers", () => {
    const fixedIds = [
      ...authenticatedAccountingFixture.weightedCostCases.flatMap((fixture) => [
        fixture.productId,
        fixture.initialMovementId,
        fixture.initialReferenceId,
        fixture.receiptMovementId,
        fixture.receiptReferenceId,
      ]),
      authenticatedAccountingFixture.shrinkage.productId,
      authenticatedAccountingFixture.shrinkage.initialMovementId,
      authenticatedAccountingFixture.shrinkage.initialReferenceId,
      authenticatedAccountingFixture.shrinkage.movementId,
      authenticatedAccountingFixture.shrinkage.referenceId,
    ];

    expect(new Set(fixedIds).size).toBe(fixedIds.length);
    expect(fixedIds.every((id) => id.startsWith("qa_bazaar_auth_accounting_"))).toBe(true);
  });
});
