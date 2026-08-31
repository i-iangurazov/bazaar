import { readFileSync } from "node:fs";
import path from "node:path";

import Papa from "papaparse";
import { describe, expect, it } from "vitest";

import { canonicalAuthenticatedRoutes } from "../e2e/authenticated/route-inventory";
import { publicCanonicalRouteInventory } from "../e2e/public-route-inventory";

type CanonicalAuditRow = {
  ID: string;
  "Route/pattern": string;
  Authentication: string;
};

const auditInventoryPath = path.resolve(
  "tmp/bazaar-audit-final-2026-08-31/route-matrix-canonical-116.csv",
);

const loadFrozenCanonicalAudit = () => {
  const parsed = Papa.parse<CanonicalAuditRow>(readFileSync(auditInventoryPath, "utf8"), {
    header: true,
    skipEmptyLines: true,
  });
  expect(parsed.errors).toEqual([]);
  return parsed.data;
};

const sorted = (values: readonly string[]) =>
  [...values].sort((left, right) => left.localeCompare(right));

describe("frozen 116-route audit reconciliation", () => {
  it("maps every frozen public and authenticated pattern exactly once without changing its denominator", () => {
    const auditRows = loadFrozenCanonicalAudit();
    expect(auditRows).toHaveLength(116);
    expect(new Set(auditRows.map((row) => row.ID)).size).toBe(116);
    expect(new Set(auditRows.map((row) => row["Route/pattern"])).size).toBe(116);

    const frozenPublicPatterns = auditRows
      .filter((row) => row.Authentication === "PUBLIC / signed out")
      .map((row) => row["Route/pattern"]);
    const frozenAuthenticatedPatterns = auditRows
      .filter((row) => row.Authentication !== "PUBLIC / signed out")
      .map((row) => row["Route/pattern"]);

    expect(frozenPublicPatterns).toHaveLength(41);
    expect(frozenAuthenticatedPatterns).toHaveLength(75);
    expect(new Set(canonicalAuthenticatedRoutes.map((route) => route.pattern)).size).toBe(75);
    expect(sorted(canonicalAuthenticatedRoutes.map((route) => route.pattern))).toEqual(
      sorted(frozenAuthenticatedPatterns),
    );

    const currentPublicPatterns = publicCanonicalRouteInventory.map((route) => route.pattern);
    expect(new Set(currentPublicPatterns).size).toBe(currentPublicPatterns.length);
    for (const frozenPattern of frozenPublicPatterns) {
      expect(currentPublicPatterns, `missing frozen public route ${frozenPattern}`).toContain(
        frozenPattern,
      );
    }

    const mappedFrozenPatterns = [
      ...frozenPublicPatterns,
      ...canonicalAuthenticatedRoutes.map((route) => route.pattern),
    ];
    expect(mappedFrozenPatterns).toHaveLength(116);
    expect(new Set(mappedFrozenPatterns).size).toBe(116);
  });
});
