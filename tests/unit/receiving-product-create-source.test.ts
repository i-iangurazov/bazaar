import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("receiving product creation handoff source", () => {
  it("saves the current receiving draft before navigating to product creation", async () => {
    const source = await readSource("src/app/(app)/inventory/receiving/page.tsx");

    expect(source).toContain("bazaar:inventory-receiving-draft:");
    expect(source).toContain("writeReceivingDraft(draftKey");
    expect(source).toContain('returnTo: "/inventory/receiving"');
    expect(source).toContain("returnSource: receivingReturnSource");
    expect(source).toContain("receivingDraftKey: draftKey");
    expect(source).toContain("router.push(`/products/new?");
    expect(source).toContain('t("receivingCreateProduct")');
  });

  it("restores draft lines and searches for the newly-created product on return", async () => {
    const source = await readSource("src/app/(app)/inventory/receiving/page.tsx");

    expect(source).toContain("readReceivingDraft(returningDraftKey)");
    expect(source).toContain("setLines(draft.lines)");
    expect(source).toContain("setSearch(createdProductName || draft.search)");
    expect(source).toContain("trpcUtils.inventory.searchProducts.invalidate()");
    expect(source).toContain("onValueChange={handleStoreChange}");
  });

  it("returns from product creation with the product identity while preserving normal creation", async () => {
    const source = await readSource("src/app/(app)/products/new/page.tsx");

    expect(source).toContain("resolveSafeReturnTo");
    expect(source).toContain("buildReturnPath");
    expect(source).toContain("createdProductId");
    expect(source).toContain("createdProductName");
    expect(source).toContain("receivingDraftKey");
    expect(source).toContain("isReceivingReturnFlow");
    expect(source).toContain("trpcUtils.inventory.searchProducts.invalidate()");
    expect(source).toContain("router.push(`/products/${product.id}`)");
  });
});
