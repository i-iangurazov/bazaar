import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BazaarCatalogStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  authenticatedCatalogPublicationFixture,
  authenticatedCatalogPublicationRecords,
} from "../e2e/authenticated/catalog-publication-contract";
import { authenticatedE2EIds, authenticatedE2ESeedPrefix } from "../e2e/authenticated/contract";

const readSource = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

describe("authenticated catalog-publication acceptance contract", () => {
  it("owns deterministic draft catalogs and tenant-distinct public products", () => {
    const fixture = authenticatedCatalogPublicationFixture;
    expect(authenticatedCatalogPublicationRecords).toHaveLength(2);
    expect(new Set(authenticatedCatalogPublicationRecords.map((record) => record.id)).size).toBe(2);
    expect(new Set(authenticatedCatalogPublicationRecords.map((record) => record.slug)).size).toBe(
      2,
    );
    expect(
      authenticatedCatalogPublicationRecords.every(
        (record) =>
          record.status === BazaarCatalogStatus.DRAFT &&
          record.title.startsWith(authenticatedE2ESeedPrefix) &&
          record.product.name.startsWith(authenticatedE2ESeedPrefix) &&
          record.product.sku.startsWith(authenticatedE2ESeedPrefix) &&
          record.publicUrlPath === `/c/${record.slug}`,
      ),
    ).toBe(true);
    expect(fixture.primary.organizationId).toBe(authenticatedE2EIds.primaryOrganization);
    expect(fixture.primary.storeId).toBe(authenticatedE2EIds.primaryStore);
    expect(fixture.foreign.organizationId).toBe(authenticatedE2EIds.secondOrganization);
    expect(fixture.foreign.storeId).toBe(authenticatedE2EIds.secondTenantStore);
    expect(fixture.primary.product.id).not.toBe(fixture.foreign.product.id);
  });

  it("fails closed on id, slug, store, product and assignment collisions before writes", () => {
    const seeder = readSource("scripts/playwright-authenticated-catalog-publication-fixture.ts");
    const mainSeeder = readSource("scripts/playwright-authenticated-fixture.ts");
    expect(seeder).toContain("assertCatalogPublicationSeedOwnership");
    expect(seeder).toContain("Refusing catalog ownership collision");
    expect(seeder).toContain("Refusing catalog-product ownership collision");
    expect(seeder).toContain("Refusing catalog-assignment ownership collision");
    expect(seeder).toContain("Refusing catalog-visibility ownership collision");
    expect(seeder.indexOf("assertCatalogPublicationSeedOwnership(prisma)")).toBeLessThan(
      seeder.indexOf("prisma.$transaction"),
    );
    expect(seeder).toContain("status: BazaarCatalogStatus.DRAFT");
    expect(seeder).toContain("publishedAt: null");
    expect(seeder).not.toMatch(/\b(?:TRUNCATE|DROP\s+(?:DATABASE|SCHEMA|TABLE))\b/i);
    expect(mainSeeder).toContain(
      'import { seedAuthenticatedCatalogPublicationFixtures } from "./playwright-authenticated-catalog-publication-fixture"',
    );
    expect(mainSeeder).toContain("await seedAuthenticatedCatalogPublicationFixtures(prisma)");
  });

  it("allows only the local catalog settings mutation and synchronously deduplicates Save", () => {
    const auditFixture = readSource("tests/e2e/authenticated/catalog-publication-test-fixtures.ts");
    const acceptance = readSource(
      "tests/e2e/authenticated/authenticated-acceptance-catalog-publication.spec.ts",
    );
    const settingsPage = readSource(
      "src/app/(app)/operations/integrations/bazaar-catalog/page.tsx",
    );
    expect(auditFixture).toContain('catalogPublicationMutationProcedure = "bazaarCatalog.upsert"');
    expect(auditFixture).not.toContain("createCatalogCheckout");
    expect(auditFixture).not.toContain("email");
    expect(auditFixture).not.toContain("provider");
    expect(auditFixture).toContain("audit.externalRequests.push");
    expect(auditFixture).toContain("audit.blockedLocalMutations.push");
    expect(auditFixture).toContain('await route.abort("blockedbyclient")');
    expect(acceptance).toContain("fixture.foreign.storeId");
    expect(acceptance).toContain("fixture.primary.publicUrlPath");
    expect(acceptance).toContain("BAZAAR_CATALOG_SETTINGS_UPDATED");
    expect(acceptance).toContain("seedAuthenticatedCatalogPublicationFixtures(prisma)");
    expect(settingsPage).toContain("const saveInFlightRef = useRef(false)");
    expect(settingsPage).toContain("saveInFlightRef.current = true");
    expect(settingsPage).toContain("saveInFlightRef.current = false");
    expect(settingsPage).toContain("!selectedStoreId || saveInFlightRef.current");
  });
});
