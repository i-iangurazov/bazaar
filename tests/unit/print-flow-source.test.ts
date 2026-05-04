import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("print flow source wiring", () => {
  it("inventory bulk print uses quick print instead of the legacy settings modal", async () => {
    const source = await readSource("src/app/(app)/inventory/page.tsx");
    const printButtonStart = source.indexOf('data-tour="inventory-print-tags"');
    const printButtonSource = source.slice(printButtonStart, printButtonStart + 900);

    expect(source).toContain("const handleInventoryQuickPrint");
    expect(source).toContain("resolveLabelPrintFlowAction");
    expect(source).toContain("setPrintSetupOpen(true)");
    expect(printButtonSource).toContain("handleInventoryQuickPrint");
    expect(printButtonSource).not.toContain("setLegacyInventoryPrintModalOpen");
    expect(source).not.toContain("setLegacyInventoryPrintModalOpen(true)");
  });

  it("normal product quick print does not call the legacy products print modal", async () => {
    const source = await readSource("src/app/(app)/products/page.tsx");
    const quickPrintStart = source.indexOf("const openPrintForProducts");
    const quickPrintEnd = source.indexOf("const getProductActions", quickPrintStart);
    const quickPrintSource = source.slice(quickPrintStart, quickPrintEnd);
    const legacyOpenMatches = [...source.matchAll(/setLegacyProductsPrintModalOpen\(true\)/g)];

    expect(quickPrintSource).toContain("resolveLabelPrintFlowAction");
    expect(quickPrintSource).toContain("performPrintTags(activeIds, savedValues, \"print\")");
    expect(quickPrintSource).not.toContain("setLegacyProductsPrintModalOpen");
    expect(source).not.toContain("__seedPrintQueue");
    expect(source).toContain("__seedLegacyProductsPrintModalQueue");
    expect(legacyOpenMatches).toHaveLength(1);
    expect(source.slice(Math.max(0, legacyOpenMatches[0].index - 350), legacyOpenMatches[0].index))
      .toContain("__seedLegacyProductsPrintModalQueue");
  });

  it("legacy products print modal is dev-only and not exposed by primary UI actions", async () => {
    const source = await readSource("src/app/(app)/products/page.tsx");
    const primaryBulkStart = source.lastIndexOf('data-tour="products-print-tags"');
    const primaryBulkSource = source.slice(primaryBulkStart, primaryBulkStart + 900);

    expect(source).toContain("legacyProductsPrintModalEnabled");
    expect(source).toContain("legacyProductsPrintModalEnabled ? (");
    expect(primaryBulkSource).toContain("openPrintForProducts(selectedList)");
    expect(primaryBulkSource).not.toContain("setLegacyProductsPrintModalOpen");
  });
});
