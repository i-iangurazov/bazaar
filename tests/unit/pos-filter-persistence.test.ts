import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const persistentFilterSources = [
  "src/app/(app)/pos/history/page.tsx",
  "src/app/(app)/pos/registers/page.tsx",
  "src/app/(app)/pos/kkm/page.tsx",
  "src/components/pos/receipt-registry.tsx",
];

describe("POS filter persistence", () => {
  it.each(persistentFilterSources)("restores and replaces URL filters in %s", (sourcePath) => {
    const source = readFileSync(sourcePath, "utf8");
    expect(source).toContain("useSearchParams");
    expect(source).toContain("buildPosFilterHref");
    expect(source).toMatch(/router\.replace\(href, \{ scroll: false \}\)/);
  });

  it("persists both receipt routes through their shared registry", () => {
    for (const page of [
      "src/app/(app)/pos/receipts/page.tsx",
      "src/app/(app)/reports/receipts/page.tsx",
    ]) {
      expect(readFileSync(page, "utf8")).toContain("<ReceiptRegistry");
    }
  });

  it("keeps the POS register URL context while updating history filters", () => {
    const source = readFileSync("src/app/(app)/pos/history/page.tsx", "utf8");
    expect(source).toContain("const searchParamsString = searchParams.toString()");
    expect(source).toContain("selectRegister(nextRegisterId)");
    expect(source).toContain("returnsPage: returnsPage === 1 ? null : returnsPage");
  });
});
