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
    const quickPrintStart = source.indexOf("const handleInventoryQuickPrint");
    const quickPrintEnd = source.indexOf("const handleLegacyInventoryPrintTags", quickPrintStart);
    const quickPrintSource = source.slice(quickPrintStart, quickPrintEnd);

    expect(source).toContain("const handleInventoryQuickPrint");
    expect(source).toContain("resolveLabelPrintFlowAction");
    expect(source).toContain("setPrintSetupOpen(true)");
    expect(quickPrintSource).toContain("trpcUtils.products.byIds.fetch");
    expect(quickPrintSource).toContain("printMissingBarcodeCount");
    expect(quickPrintSource).not.toContain("printWithoutBarcodeConfirmRequired");
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
    expect(quickPrintSource).toContain("trpcUtils.products.byIds.fetch");
    expect(quickPrintSource).toContain("printMissingBarcodeCount");
    expect(quickPrintSource).toContain("performPrintTags(activeIds, savedValues, \"print\")");
    expect(quickPrintSource.indexOf("setPrintQueue(uniqueIds)")).toBeGreaterThan(-1);
    expect(quickPrintSource.indexOf("setPrintSetupOpen(true)")).toBeGreaterThan(
      quickPrintSource.indexOf("setPrintQueue(uniqueIds)"),
    );
    expect(quickPrintSource).not.toContain("printWithoutBarcodeConfirmRequired");
    expect(quickPrintSource).not.toContain("setLegacyProductsPrintModalOpen");
    expect(source).not.toContain("__seedPrintQueue");
    expect(source).toContain("__seedLegacyProductsPrintModalQueue");
    expect(legacyOpenMatches).toHaveLength(1);
    expect(source.slice(Math.max(0, legacyOpenMatches[0].index - 350), legacyOpenMatches[0].index))
      .toContain("__seedLegacyProductsPrintModalQueue");
  });

  it("products quick print can use an existing saved store profile when no store filter is selected", async () => {
    const pageSource = await readSource("src/app/(app)/products/page.tsx");
    const serviceSource = await readSource("src/server/services/products/read.ts");
    const defaultStoreStart = pageSource.indexOf("const defaultPrintStoreId");
    const defaultStoreSource = pageSource.slice(defaultStoreStart, defaultStoreStart + 260);

    expect(serviceSource).toContain("printerSettings: {");
    expect(defaultStoreSource).toContain("store.printerSettings?.id");
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
