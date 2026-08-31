import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  authenticatedAdvancedProductFixture,
  authenticatedAdvancedSeededProducts,
} from "../e2e/authenticated/advanced-product-contract";
import { authenticatedE2EIds, authenticatedE2ESeedPrefix } from "../e2e/authenticated/contract";

const readSource = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

describe("authenticated advanced-product acceptance contract", () => {
  it("uses isolated QA-owned records and exact inventory baselines", () => {
    const fixture = authenticatedAdvancedProductFixture;
    const ids = authenticatedAdvancedSeededProducts.flatMap((product) => [
      product.id,
      product.storeProductId,
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      authenticatedAdvancedSeededProducts.every(
        (product) =>
          product.id.startsWith("qa_bazaar_advanced_") &&
          product.name.startsWith(authenticatedE2ESeedPrefix) &&
          product.sku.startsWith(authenticatedE2ESeedPrefix),
      ),
    ).toBe(true);
    expect(authenticatedAdvancedSeededProducts.map((product) => product.id)).not.toContain(
      authenticatedE2EIds.primaryProduct,
    );
    expect(fixture.component).toMatchObject({ onHand: 20, unitCostKgs: 25 });
    expect(fixture.browserBundle).toMatchObject({
      createComponentQty: 3,
      editedComponentQty: 4,
      assembleQty: 2,
    });
  });

  it("guards exact ownership before narrowly cleaning an interrupted browser bundle", () => {
    const seeder = readSource("scripts/playwright-authenticated-advanced-product-fixture.ts");
    const mainSeeder = readSource("scripts/playwright-authenticated-fixture.ts");
    expect(seeder).toContain("assertAdvancedProductSeedOwnership");
    expect(seeder).toContain("Refusing to clean non-QA browser bundle");
    expect(seeder).toContain("bundleAssemble:${fixture.browserBundle.sku}");
    expect(seeder).toContain("$transaction");
    expect(seeder).toContain(".upsert(");
    expect(seeder).toContain("preciseAvgCostKgs: null");
    expect(seeder).toContain("preciseCostBasisQty: null");
    expect(seeder).toContain("costBasisValueKgs: null");
    expect(seeder).toContain("valuationStatus: null");
    expect(seeder).toContain("valuationUpdatedAt: null");
    expect(seeder).toContain("valuationLegacyUpdatedAt: null");
    expect(seeder).not.toMatch(/\b(?:TRUNCATE|DROP\s+(?:DATABASE|SCHEMA|TABLE))\b/i);
    expect(mainSeeder).toContain(
      'import { seedAuthenticatedAdvancedProductFixtures } from "./playwright-authenticated-advanced-product-fixture"',
    );
    expect(mainSeeder).toContain("await seedAuthenticatedAdvancedProductFixtures(prisma)");
  });

  it("requires revision-aware product updates and synchronous assembly deduplication", () => {
    const schemas = readSource("src/server/trpc/routers/products.schemas.ts");
    const mutations = readSource("src/server/services/products/mutations.ts");
    const service = readSource("src/server/services/products.ts");
    const page = readSource("src/app/(app)/products/[id]/page.tsx");
    expect(schemas).toContain("expectedUpdatedAt: z.coerce.date()");
    expect(mutations).toContain("expectedUpdatedAt: input.expectedUpdatedAt");
    expect(service).toContain('throw new AppError("productStaleUpdate", "CONFLICT", 409)');
    expect(page).toContain("const productRevision = productQuery.data.updatedAt");
    expect(page).toContain("expectedUpdatedAt: productRevision");
    expect(page).toContain("assembleInFlightRef.current = true");
    expect(page).toContain("assembleInFlightRef.current = false");
  });

  it("serves only QA-owned post-boot local images and proves browser decoding", () => {
    const acceptance = readSource(
      "tests/e2e/authenticated/authenticated-acceptance-advanced-products.spec.ts",
    );
    expect(acceptance).toContain("url.pathname.startsWith(localImageUrlPrefix)");
    expect(acceptance).toContain("readFile(localImageFilePath(url.pathname))");
    expect(acceptance).toContain("await route.fallback()");
    expect(acceptance).toContain("element.naturalWidth > 0 && element.naturalHeight > 0");
  });
});
