import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { authenticatedE2ESeedPrefix } from "../e2e/authenticated/contract";
import { authenticatedPosOperationsFixture as fixture } from "../e2e/authenticated/pos-operations-contract";
import { posOperationsMutationProcedures } from "../e2e/authenticated/pos-operations-test-fixtures";

const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("authenticated POS operations acceptance contract", () => {
  it("uses isolated owned fixtures and reconciles quantity, value, and drawer math exactly", () => {
    expect(fixture.register.id).not.toBe(fixture.foreignRegister.id);
    expect(fixture.shift.id).not.toBe(fixture.foreignShift.id);
    expect(fixture.product.name.startsWith(authenticatedE2ESeedPrefix)).toBe(true);
    expect(fixture.product.sku.startsWith(authenticatedE2ESeedPrefix)).toBe(true);
    expect(fixture.customer.name.startsWith(authenticatedE2ESeedPrefix)).toBe(true);
    expect(fixture.debtCustomerName.startsWith(authenticatedE2ESeedPrefix)).toBe(true);
    expect(fixture.product.barcode).toMatch(/^\d{13}$/);
    expect(fixture.cashSaleTotalKgs).toBe(240);
    expect(fixture.returnTotalKgs).toBe(120);
    expect(fixture.debtSaleTotalKgs).toBe(120);
    expect(fixture.expectedCashKgs).toBe(350);
    expect(fixture.countedCashKgs - fixture.expectedCashKgs).toBe(-5);
    expect(fixture.expectedFinalOnHand).toBe(28);
    expect(fixture.expectedFinalOnHand * fixture.product.unitCostKgs).toBe(1_400);
  });

  it("allows only the eleven POS mutations exercised by the workflow", () => {
    expect(posOperationsMutationProcedures).toEqual([
      "pos.sales.createDraft",
      "pos.sales.addLine",
      "pos.sales.updateLine",
      "pos.sales.updateCustomer",
      "pos.sales.complete",
      "pos.returns.createDraft",
      "pos.returns.addLine",
      "pos.returns.complete",
      "pos.debts.settle",
      "pos.cash.record",
      "pos.shifts.close",
    ]);
    const auditSource = readSource("tests/e2e/authenticated/pos-operations-test-fixtures.ts");
    expect(auditSource).not.toContain("pos.sales.retryKkm");
    expect(auditSource).not.toContain("printing");
    expect(auditSource).toContain("audit.blockedLocalMutations.push");
    expect(auditSource).toContain('await route.abort("blockedbyclient")');
  });

  it("waits for the persisted line quantity before attempting completion", () => {
    const spec = readSource(
      "tests/e2e/authenticated/authenticated-acceptance-pos-operations.spec.ts",
    );
    expect(spec).toContain(
      'await expectMutationTotal(audit, "pos.sales.updateLine", mutationTotalsBefore.updateLine + 1)',
    );
    expect(spec).toContain(
      "openMobileSaleWithProduct(page, posOperationsAudit, fixture.cashSaleQuantity)",
    );
    expect(spec).toContain("expect(posOperationsAudit.allowedMutations).toHaveLength(16)");
    expect(spec).toContain("prisma.customerOrderLine.findFirst");
    expect(spec).toContain(".toBe(quantity)");
  });

  it("fails closed before cleanup, rejects provider artifacts, and is wired into the main seeder", () => {
    const seeder = readSource("scripts/playwright-authenticated-pos-operations-fixture.ts");
    const mainSeeder = readSource("scripts/playwright-authenticated-fixture.ts");
    expect(seeder).toContain("assertOwnedDependencies(prisma)");
    expect(seeder).toContain("assertFixtureIdentityOwnership(prisma)");
    expect(seeder).toContain("loadAndAssertRuntimeRecords(prisma)");
    expect(seeder.indexOf("assertOwnedDependencies(prisma)")).toBeLessThan(
      seeder.indexOf("prisma.$transaction"),
    );
    expect(seeder).toContain("produced a forbidden external side effect");
    expect(seeder).toContain("compliance.enableKkm");
    expect(seeder).toContain("printer.receiptAutoPrintEnabled");
    expect(seeder).toContain("fixture.idempotencyKeyPrefix");
    expect(mainSeeder).toContain("seedAuthenticatedPosOperationsFixtures");
    expect(mainSeeder).toContain("await seedAuthenticatedPosOperationsFixtures(prisma)");
  });

  it("guards every fresh-key rapid-submit boundary in the UI", () => {
    const history = readSource("src/app/(app)/pos/history/page.tsx");
    const debts = readSource("src/app/(app)/pos/debts/page.tsx");
    const shifts = readSource("src/app/(app)/pos/shifts/page.tsx");
    for (const [source, guard] of [
      [history, "returnSubmitInFlightRef"],
      [debts, "settleDebtInFlightRef"],
      [shifts, "cashMovementSubmitInFlightRef"],
      [shifts, "closeShiftSubmitInFlightRef"],
    ] as const) {
      expect(source).toContain(`const ${guard} = useRef(false)`);
      expect(source).toContain(`if (${guard}.current)`);
      expect(source).toContain(`${guard}.current = true`);
      expect(source).toContain(`${guard}.current = false`);
    }
  });

  it("asserts exact persistence and zero fiscal, refund-request, and email side effects", () => {
    const spec = readSource(
      "tests/e2e/authenticated/authenticated-acceptance-pos-operations.spec.ts",
    );
    expect(spec).toContain("rapidClick");
    expect(spec).toContain("finalStockMovements");
    expect(spec).toContain("finalCost.preciseCostBasisQty");
    expect(spec).toContain("finalCost.preciseAvgCostKgs");
    expect(spec).toContain("finalCost.costBasisValueKgs");
    expect(spec).toContain("finalShift.expectedCashKgs");
    expect(spec).toContain("fiscalReceiptCount");
    expect(spec).toContain("refundRequestCount");
    expect(spec).toContain("emailLogCount");
    expect(spec).toContain("automationDeliveryCount");
    expect(spec).toContain("assertCleanPosOperationsAudit");
  });
});
