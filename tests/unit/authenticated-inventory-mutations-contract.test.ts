import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { authenticatedE2EIds, authenticatedE2ESeedPrefix } from "../e2e/authenticated/contract";
import {
  authenticatedInventoryMutationFixture,
  authenticatedInventoryMutationProducts,
} from "../e2e/authenticated/inventory-mutations-contract";

const readSource = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

describe("authenticated inventory mutation acceptance contract", () => {
  it("uses unique QA-owned product and document identifiers outside the route fixtures", () => {
    const productIds = authenticatedInventoryMutationProducts.map((product) => product.id);
    const skus = authenticatedInventoryMutationProducts.map((product) => product.sku);
    const ownedIds = authenticatedInventoryMutationProducts.flatMap((product) => [
      product.id,
      product.storeProductId,
      product.primarySnapshotId,
      product.productCostId,
    ]);

    expect(new Set(productIds).size).toBe(productIds.length);
    expect(new Set(skus).size).toBe(skus.length);
    expect(new Set(ownedIds).size).toBe(ownedIds.length);
    expect(
      authenticatedInventoryMutationProducts.every(
        (product) =>
          product.id.startsWith("qa_bazaar_mutation_") &&
          product.name.startsWith(authenticatedE2ESeedPrefix) &&
          product.sku.startsWith(authenticatedE2ESeedPrefix),
      ),
    ).toBe(true);
    expect(productIds).not.toContain(authenticatedE2EIds.primaryProduct);
    expect(authenticatedInventoryMutationFixture.stockCount.countId).not.toBe(
      authenticatedE2EIds.primaryStockCount,
    );
    expect(authenticatedInventoryMutationFixture.guidanceToursDisabledMarker).toBe(
      "__guidance:tours_disabled__",
    );
  });

  it("pins independent inventory baselines and a non-zero stock-count variance", () => {
    expect(authenticatedInventoryMutationFixture.adjustment.primaryOnHand).toBe(20);
    expect(authenticatedInventoryMutationFixture.receiving.primaryOnHand).toBe(20);
    expect(authenticatedInventoryMutationFixture.transfer).toMatchObject({
      primaryOnHand: 20,
      secondaryOnHand: 10,
    });
    expect(authenticatedInventoryMutationFixture.writeOff.primaryOnHand).toBe(20);
    expect(authenticatedInventoryMutationFixture.mobile.primaryOnHand).toBe(20);
    expect(authenticatedInventoryMutationFixture.stockCount).toMatchObject({
      primaryOnHand: 20,
      countedQty: 24,
    });
  });

  it("keeps the dedicated seeder guarded, upsert-only, and wired once", () => {
    const seeder = readSource("scripts/playwright-authenticated-inventory-mutations-fixture.ts");
    const mainFixture = readSource("scripts/playwright-authenticated-fixture.ts");

    expect(seeder).toContain("assertMutationSeedOwnership");
    expect(seeder).toContain("authenticatedE2ESeedPrefix");
    expect(seeder).toContain("$transaction");
    expect(seeder).toContain(".upsert(");
    expect(seeder).not.toMatch(/\.(?:delete|deleteMany)\s*\(/);
    expect(seeder).not.toMatch(/\b(?:TRUNCATE|DROP\s+(?:DATABASE|SCHEMA|TABLE))\b/i);
    expect(mainFixture.match(/seedAuthenticatedInventoryMutationFixtures\(prisma\)/g)).toHaveLength(
      1,
    );
  });

  it("allowlists only the owned local UI mutations and blocks every other write", () => {
    const auditFixture = readSource("tests/e2e/authenticated/mutation-test-fixtures.ts");
    const expectedProcedures = [
      "products.create",
      "products.update",
      "inventory.adjust",
      "inventory.postStockReceiving",
      "inventory.transfer",
      "inventory.postStockWriteOff",
      "stockCounts.setLineCountedQty",
      "stockCounts.applyCount",
    ];

    for (const procedure of expectedProcedures) {
      expect(auditFixture).toContain(`"${procedure}"`);
    }
    expect(auditFixture).toContain("blockedLocalMutations");
    expect(auditFixture).toContain("externalRequests");
    expect(auditFixture).toContain("externalWebSockets");
    expect(auditFixture).not.toMatch(/(?:email|payment|fiscal|provider)\.[A-Za-z]+/);
  });

  it("guards every covered Save, Post, and Apply boundary before React can re-render", () => {
    const guardedSources = [
      ["src/app/(app)/products/new/page.tsx", "createInFlightRef"],
      ["src/app/(app)/products/[id]/page.tsx", "updateInFlightRef"],
      ["src/app/(app)/inventory/page.tsx", "adjustInFlightRef"],
      ["src/components/inventory/receiving-workflow.tsx", "submissionInFlightRef"],
      ["src/components/inventory/transfer-workflow.tsx", "submissionInFlightRef"],
      ["src/components/inventory/write-off-workflow.tsx", "submissionInFlightRef"],
      ["src/app/(app)/inventory/counts/[id]/page.tsx", "setQtyInFlightRef"],
      ["src/app/(app)/inventory/counts/[id]/page.tsx", "applyActionPendingRef"],
    ] as const;

    for (const [relativePath, guardName] of guardedSources) {
      const source = readSource(relativePath);
      expect(source).toContain(`${guardName}.current`);
      expect(source).toContain(`${guardName}.current = true`);
      expect(source).toContain(`${guardName}.current = false`);
    }
  });
});
