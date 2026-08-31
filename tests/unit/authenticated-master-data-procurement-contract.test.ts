import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  authenticatedMasterDataProcurementFixture,
  authenticatedMasterDataProcurementProducts,
} from "../e2e/authenticated/master-data-procurement-contract";
import { authenticatedE2ESeedPrefix } from "../e2e/authenticated/contract";

describe("authenticated master-data and procurement fixture contract", () => {
  it("owns a deterministic 26-product pagination set", () => {
    expect(authenticatedMasterDataProcurementProducts).toHaveLength(26);
    expect(
      new Set(authenticatedMasterDataProcurementProducts.map((product) => product.id)).size,
    ).toBe(26);
    expect(
      new Set(authenticatedMasterDataProcurementProducts.map((product) => product.sku)).size,
    ).toBe(26);
    expect(
      authenticatedMasterDataProcurementProducts.every(
        (product) =>
          product.name.startsWith(authenticatedE2ESeedPrefix) &&
          product.sku.startsWith(authenticatedE2ESeedPrefix),
      ),
    ).toBe(true);
  });

  it("uses explicit QA-owned supplier/category and exact receiving arithmetic", () => {
    const fixture = authenticatedMasterDataProcurementFixture;
    expect(fixture.category.name).toMatch(/^QA-BAZAAR /);
    expect(fixture.supplier.name).toMatch(/^QA-BAZAAR /);
    expect(fixture.attribute.labelKg).toContain("кыргыз");
    expect(fixture.attribute.productId).toBe(authenticatedMasterDataProcurementProducts[25]!.id);
    expect(fixture.receiveProduct.baselineOnHand).toBe(8);
    expect(fixture.receiveProduct.purchaseQty).toBe(3);
    expect(fixture.receiveProduct.purchaseUnitCostKgs).toBe(52.5);
  });

  it("is wired into the guarded main seed and keeps an exact mutation allowlist", () => {
    const mainSeed = readFileSync(
      join(process.cwd(), "scripts/playwright-authenticated-fixture.ts"),
      "utf8",
    );
    const procurementSeed = readFileSync(
      join(process.cwd(), "scripts/playwright-authenticated-master-data-procurement-fixture.ts"),
      "utf8",
    );
    const mutationFixture = readFileSync(
      join(process.cwd(), "tests/e2e/authenticated/master-data-procurement-test-fixtures.ts"),
      "utf8",
    );

    expect(mainSeed).toContain("seedAuthenticatedMasterDataProcurementFixtures");
    expect(mainSeed).toContain("await seedAuthenticatedMasterDataProcurementFixtures(prisma)");
    expect(procurementSeed).toContain("preciseAvgCostKgs: product.unitCostKgs");
    expect(procurementSeed).toContain("preciseCostBasisQty: product.baselineOnHand");
    expect(procurementSeed).toContain('valuationStatus: "PRECISE"');
    expect(procurementSeed).toContain("valuationUpdatedAt: valuationTimestamp");
    expect(procurementSeed).toContain("valuationLegacyUpdatedAt: valuationTimestamp");
    expect(procurementSeed).toContain("updatedAt: valuationTimestamp");
    for (const procedure of [
      "products.create",
      "products.update",
      "productCategories.create",
      "productCategories.remove",
      "productCategories.setStoreVisibility",
      "units.create",
      "units.update",
      "units.remove",
      "attributes.create",
      "attributes.update",
      "attributes.remove",
      "suppliers.create",
      "suppliers.update",
      "purchaseOrders.create",
      "purchaseOrders.updateLine",
      "purchaseOrders.submit",
      "purchaseOrders.approve",
      "purchaseOrders.receive",
      "purchaseOrders.cancel",
    ]) {
      expect(mutationFixture).toContain(`"${procedure}"`);
    }
    expect(mutationFixture).toContain("audit.blockedLocalMutations.push");
    expect(mutationFixture).toContain('await route.abort("blockedbyclient")');
  });
});
