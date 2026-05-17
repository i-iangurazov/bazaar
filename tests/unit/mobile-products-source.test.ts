import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("mobile products source", () => {
  it("uses a mobile-only product toolbar and photo-first cards without changing desktop controls", async () => {
    const source = await readSource("src/app/(app)/products/page.tsx");

    expect(source).toContain("data-mobile-products-toolbar");
    expect(source).toContain('className="hidden w-full md:block md:max-w-xs"');
    expect(source).toContain('mobileItemsClassName="grid grid-cols-1 gap-3"');
    expect(source).toContain("relative h-24 w-24");
    expect(source).toContain("Phones always use");
    expect(source).toContain('action.key === "edit" ? { ...action, openInNewTab: false } : action');
    expect(source).toContain('variant={readiness === "missingImage" ? "primary" : "secondary"}');
    expect(source).toContain('variant={readiness === "outOfStock" ? "primary" : "secondary"}');
    expect(source).toContain("enableBarcode ? (");
    expect(source).toContain("mobileSheet");
  });

  it("keeps mobile product form sectioned with an in-flow mobile save action", async () => {
    const source = await readSource("src/components/product-form.tsx");

    expect(source).toContain("data-mobile-product-form-sections");
    expect(source).toContain("mobileProductSectionClassName");
    expect(source).toContain('className="space-y-6 pb-28 md:pb-0"');
    expect(source).toContain('<FormActions className="hidden md:flex">');
    expect(source).toContain("scrollbar-none -mx-1 flex gap-2 overflow-x-auto");
    expect(source).toContain(
      'className="mt-4 rounded-none border border-border bg-background p-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)] md:hidden"',
    );
    expect(source).toContain('enableSku ? [t("sku")] : []');
    expect(source).toContain('enableBarcode ? [t("barcodes")] : []');
  });
});
