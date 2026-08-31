import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const routes = [
  "src/app/(app)/pos/page.tsx",
  "src/app/(app)/pos/registers/page.tsx",
  "src/app/(app)/pos/shifts/page.tsx",
  "src/app/(app)/pos/history/page.tsx",
  "src/app/(app)/pos/debts/page.tsx",
];

const kkmRoute = "src/app/(app)/pos/kkm/page.tsx";

describe("POS query error states", () => {
  it.each(routes)("surfaces a retry action on %s", (route) => {
    const source = readFileSync(route, "utf8");
    expect(source).toContain('import { QueryErrorState } from "@/components/query-error-state"');
    expect(source).toMatch(/\.isError/);
    expect(source).toMatch(/<QueryErrorState[\s\S]*?\.refetch\(\)/);
  });

  it("surfaces dependency-specific retry actions on the KKM route", () => {
    const source = readFileSync(kkmRoute, "utf8");
    expect(source).toMatch(/kkmEntitlementsQuery\.isError/);
    expect(source).toMatch(/storesQuery\.isError \|\| receiptsQuery\.isError/);
    expect(source).toMatch(/kkmEntitlementsQuery\.refetch\(\)/);
    expect(source).toMatch(/storesQuery\.refetch\(\)/);
    expect(source).toMatch(/receiptsQuery\.refetch\(\)/);
    expect(source).toContain('<Alert variant="destructive" role="alert"');
  });

  it("does not present failed primary POS lists as successful empty results", () => {
    for (const route of [...routes, kkmRoute]) {
      const source = readFileSync(route, "utf8");
      expect(source).toMatch(/!\w+Query\.isError/);
    }
  });
});
