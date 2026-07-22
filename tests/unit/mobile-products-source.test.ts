import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("mobile products source", () => {
  it("uses a mobile-only product toolbar and photo-first cards without changing desktop controls", async () => {
    const source = await readSource("src/app/(app)/products/page.tsx");

    expect(source).toContain("data-mobile-products-toolbar");
    expect(source).toContain('filtersClassName="hidden border-0 bg-transparent p-0 md:block"');
    expect(source).toContain('mobileItemsClassName="grid grid-cols-1 gap-3"');
    expect(source).toContain("relative h-24 w-24");
    expect(source).toContain("Phones always use");
    expect(source).toContain('action.key === "edit" ? { ...action, openInNewTab: false } : action');
    expect(source).toContain('variant={readiness === "missingImage" ? "primary" : "secondary"}');
    expect(source).toContain('variant={readiness === "outOfStock" ? "primary" : "secondary"}');
    expect(source).toContain("enableBarcode ? (");
  });

  it("keeps product duplication wired to a mobile-sheet dialog", async () => {
    const [pageSource, dialogSource] = await Promise.all([
      readSource("src/app/(app)/products/page.tsx"),
      readSource("src/components/products/product-duplicate-dialog.tsx"),
    ]);

    expect(pageSource).toContain(
      'import { ProductDuplicateDialog } from "@/components/products/product-duplicate-dialog";',
    );
    expect(pageSource).toContain("<ProductDuplicateDialog");
    expect(pageSource).toContain("open={Boolean(duplicateTarget)}");
    expect(dialogSource).toContain("<Modal");
    expect(dialogSource).toContain("mobileSheet");
  });

  it("keeps mobile product form sectioned with an in-flow mobile save action", async () => {
    const source = await readSource("src/components/product-form.tsx");

    expect(source).toContain("data-mobile-product-form-sections");
    expect(source).toContain("mobileProductSectionClassName");
    expect(source).toContain('className="space-y-6 pb-28 md:pb-0"');
    expect(source).toContain('<FormActions className="hidden md:flex">');
    expect(source).toContain("scrollbar-none -mx-1 flex gap-2 overflow-x-auto");
    expect(source).toContain(
      'className="mt-4 rounded-md border border-border bg-background p-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)] md:hidden"',
    );
    expect(source).toContain('enableSku ? [t("sku")] : []');
    expect(source).toContain('enableBarcode ? [t("barcodes")] : []');
  });

  it("keeps quick-create cost in the core fields after minimum stock", async () => {
    const source = await readSource("src/components/product-form.tsx");

    const minStockIndex = source.indexOf('name="minStock"');
    const quickCostIndex = source.indexOf('name="avgCostKgs"', minStockIndex);
    const barcodeIndex = source.indexOf("{compactCreate && enableBarcode", quickCostIndex);

    expect(minStockIndex).toBeGreaterThan(-1);
    expect(quickCostIndex).toBeGreaterThan(minStockIndex);
    expect(barcodeIndex).toBeGreaterThan(quickCostIndex);
    expect(source).toContain('FormLabel>{t("quickAvgCost")}</FormLabel>');
    expect(source).not.toContain('title={t("profitabilityTitle")}');
  });
});
