import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { authenticatedPosMobileFixture } from "../e2e/authenticated/pos-mobile-contract";
import { authenticatedE2ESeedPrefix } from "../e2e/authenticated/contract";

describe("authenticated POS mobile fixture contract", () => {
  it("owns a deterministic priced, valued and stocked QA product", () => {
    const fixture = authenticatedPosMobileFixture;
    expect(fixture.product.name.startsWith(authenticatedE2ESeedPrefix)).toBe(true);
    expect(fixture.product.sku.startsWith(authenticatedE2ESeedPrefix)).toBe(true);
    expect(fixture.product.barcode).toMatch(/^\d{13}$/);
    expect(fixture.product.baselineOnHand).toBeGreaterThan(fixture.product.saleQuantity);
    expect(fixture.product.basePriceKgs).toBe(137.25);
    expect(fixture.product.unitCostKgs).toBe(61.5);
    expect(fixture.discountKgs).toBeLessThan(
      fixture.product.basePriceKgs * fixture.product.saleQuantity,
    );
    expect(fixture.payments.cashKgs + fixture.payments.cardKgs).toBe(
      fixture.product.basePriceKgs * fixture.product.saleQuantity - fixture.discountKgs,
    );
    expect(fixture.customer.name.startsWith(authenticatedE2ESeedPrefix)).toBe(true);
  });

  it("keeps the browser allowlist exact and blocks all other side effects", () => {
    const source = readFileSync(
      join(process.cwd(), "tests/e2e/authenticated/pos-mobile-test-fixtures.ts"),
      "utf8",
    );
    for (const procedure of [
      "pos.sales.createDraft",
      "pos.sales.addLine",
      "pos.sales.updateLine",
      "pos.sales.updateCustomer",
      "pos.sales.updateDiscount",
      "pos.sales.complete",
    ]) {
      expect(source).toContain(`"${procedure}"`);
    }
    expect(source).not.toContain("pos.sales.retryKkm");
    expect(source).not.toContain("printing");
    expect(source).toContain("audit.blockedLocalMutations.push");
    expect(source).toContain('await route.abort("blockedbyclient")');
  });

  it("keeps seed ownership fail-closed before product and stale-draft writes", () => {
    const source = readFileSync(
      join(process.cwd(), "scripts/playwright-authenticated-pos-mobile-fixture.ts"),
      "utf8",
    );
    const mainSeed = readFileSync(
      join(process.cwd(), "scripts/playwright-authenticated-fixture.ts"),
      "utf8",
    );
    expect(source).toContain("assertPosMobileSeedOwnership");
    expect(source).toContain("Refusing to overwrite non-QA POS product");
    expect(source).toContain("Refusing to remove non-QA or posted POS draft");
    expect(source.indexOf("assertPosMobileSeedOwnership(prisma)")).toBeLessThan(
      source.indexOf("prisma.$transaction"),
    );
    expect(source).toContain("enableKkm: false");
    expect(source).toContain('receiptPrintProvider: "DISABLED"');
    expect(mainSeed).toContain("seedAuthenticatedPosMobileFixtures");
    expect(mainSeed).toContain("await seedAuthenticatedPosMobileFixtures(prisma)");
  });
});
