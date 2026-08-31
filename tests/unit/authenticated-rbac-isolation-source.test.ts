import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

describe("authenticated RBAC and isolation production acceptance", () => {
  it("keeps product export on the printing-capable role boundary", () => {
    const source = readSource("src/server/trpc/routers/products.ts");

    expect(source).toMatch(
      /exportCsv:\s*printingProcedure\.input\(exportProductsInputSchema\)\.query/,
    );
    expect(source).not.toMatch(
      /exportCsv:\s*protectedProcedure\.input\(exportProductsInputSchema\)\.query/,
    );
  });

  it("denies unauthorized price-tag printing before parsing or tenant data access", () => {
    const source = readSource("src/app/api/price-tags/pdf/route.ts");
    const permissionCheck = source.indexOf('hasPermission(user, "managePrinting")');
    const featureCheck = source.indexOf("await assertFeatureEnabled(");
    const payloadRead = source.indexOf("await request.json()");
    const productRead = source.indexOf("prisma.product.findMany(");

    expect(permissionCheck).toBeGreaterThan(-1);
    expect(permissionCheck).toBeLessThan(featureCheck);
    expect(permissionCheck).toBeLessThan(payloadRead);
    expect(permissionCheck).toBeLessThan(productRead);
  });

  it("pins every required account and readiness boundary in one production spec", () => {
    const source = readSource(
      "tests/e2e/authenticated/authenticated-acceptance-rbac-isolation.spec.ts",
    );

    for (const requirement of [
      "BZR-REQ-0106",
      "BZR-REQ-0107",
      "BZR-REQ-0108",
      "BZR-REQ-0112",
      "BZR-REQ-0113",
      "BZR-REQ-0115",
      "BZR-REQ-0184",
      "BZR-REQ-0186",
    ]) {
      expect(source).toContain(requirement);
    }
    for (const account of [
      'clientFor("admin")',
      'clientFor("manager")',
      'clientFor("staff")',
      'clientFor("cashier")',
      '"organizationOwner"',
      '"platformOwner"',
      '"secondTenantAdmin"',
    ]) {
      expect(source).toContain(account);
    }
  });

  it("blocks every non-local browser request without a host exemption", () => {
    const source = readSource(
      "tests/e2e/authenticated/authenticated-acceptance-rbac-isolation.spec.ts",
    );

    expect(source).toContain("if (url.origin !== localOrigin)");
    expect(source).toContain("audit.externalRequests.push");
    expect(source).toContain('await route.abort("blockedbyclient")');
    expect(source).not.toContain("fonts.googleapis.com");
    expect(source).not.toContain("fonts.gstatic.com");
  });

  it("uses the created product revision for optimistic-concurrency updates", () => {
    const source = readSource(
      "tests/e2e/authenticated/authenticated-acceptance-rbac-isolation.spec.ts",
    );

    expect(source).toContain("updatedAt: Date");
    expect(source).toContain("expect(created.updatedAt).toBeInstanceOf(Date)");
    expect(source).toContain("expectedUpdatedAt: created.updatedAt");
  });

  it("uses exact tenant-owned SKUs for deterministic capped global-search evidence", () => {
    const source = readSource(
      "tests/e2e/authenticated/authenticated-acceptance-rbac-isolation.spec.ts",
    );

    expect(source).toContain('query: "QA-BAZAAR-AUTH-PRIMARY"');
    expect(source).toContain('query: "QA-BAZAAR-AUTH-FOREIGN"');
    expect(source).toContain(
      "expect(data.results.map((result) => result.id)).toEqual(expectedProductIds)",
    );
  });

  it("guards the deterministic secondary POS register and never seeds a secondary shift", () => {
    const contract = readSource("tests/e2e/authenticated/contract.ts");
    const fixture = readSource("scripts/playwright-authenticated-fixture.ts");

    expect(contract).toContain('secondaryRegister: "qa_bazaar_auth_register_secondary"');
    expect(fixture).toContain(
      "[authenticatedE2EIds.secondaryRegister, authenticatedE2EIds.secondaryStore]",
    );
    expect(fixture).toContain("{ registerId: authenticatedE2EIds.secondaryRegister }");
    expect(fixture).toContain("where: { id: authenticatedE2EIds.secondaryRegister }");
    expect(fixture.match(/registerShift\.upsert/g)).toHaveLength(1);
  });
});
