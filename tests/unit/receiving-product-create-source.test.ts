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
    expect(source).toContain("createReceivingReturnParams");
    expect(source).toContain('returnTo: "/inventory/receiving"');
    expect(source).toContain("returnSource: receivingReturnSource");
    expect(source).toContain("receivingDraftKey: draftKey");
    expect(source).toContain("router.push(`/products/new?");
    expect(source).toContain('t("receivingCreateProduct")');
  });

  it("restores the receiving draft search without replacing it with the created product name", async () => {
    const source = await readSource("src/app/(app)/inventory/receiving/page.tsx");

    expect(source).toContain("readReceivingDraft(returningDraftKey)");
    expect(source).toContain("setLines(draft.lines)");
    expect(source).toContain("setSearch(draft.search)");
    expect(source).toContain("searchResultsScrollTop");
    expect(source).toContain("focusedElement");
    expect(source).not.toContain("createdProductName");
    expect(source).not.toContain("setSearch((current) => current ||");
    expect(source).toContain("createdProductId");
    expect(source).toContain("productId: createdProductId");
    expect(source).toContain('addSearchResult(result, "manual", { selectQuantity: true })');
    expect(source).toContain("trpcUtils.inventory.searchProducts.invalidate()");
    expect(source).toContain("onValueChange={handleStoreChange}");
  });

  it("returns from receiving duplicate creation without forcing the created product into search", async () => {
    const source = await readSource("src/app/(app)/products/new/page.tsx");

    expect(source).toContain("resolveSafeReturnTo");
    expect(source).toContain("buildReturnPath");
    expect(source).toContain("createdProductId");
    expect(source).not.toContain("createdProductName");
    expect(source).toContain(
      "productId: isReceivingReturnFlow && !isDuplicateFlow ? product.id : undefined",
    );
    expect(source).toContain("receivingDraftKey");
    expect(source).toContain("isReceivingReturnFlow");
    expect(source).toContain("duplicateFromProductId");
    expect(source).toContain("trpc.products.getById.useQuery");
    expect(source).toContain("trpc.products.storePricing.useQuery");
    expect(source).toContain("minStock: duplicateSourceStore?.minStock");
    expect(source).toContain("duplicateCreateSubtitle");
    expect(source).toContain("barcodes: []");
    expect(source).toContain("trpcUtils.inventory.searchProducts.invalidate()");
    expect(source).toContain("router.push(`/products/${product.id}`)");
  });

  it("adds a duplicate product action to receiving search results without clearing search", async () => {
    const receivingSource = await readSource("src/app/(app)/inventory/receiving/page.tsx");
    const inventoryRouterSource = await readSource("src/server/trpc/routers/inventory.ts");

    expect(receivingSource).toContain("receivingDuplicateProduct");
    expect(receivingSource).toContain("handleDuplicateProduct");
    expect(receivingSource).toContain('params.set("duplicateFrom", result.product.id)');
    expect(receivingSource).not.toContain('setSearch("");\n    focusQuantity(key');
    expect(inventoryRouterSource).toContain("productId: z.string().trim().optional()");
    expect(inventoryRouterSource).toContain("input.productId");
    expect(inventoryRouterSource).toContain("? { id: input.productId }");
  });

  it("limits receiving add-products search to product names", async () => {
    const receivingSource = await readSource("src/app/(app)/inventory/receiving/page.tsx");
    const inventoryRouterSource = await readSource("src/server/trpc/routers/inventory.ts");

    expect(receivingSource).toContain('const receivingProductSearchFields: ["name"] = ["name"]');
    expect(receivingSource).toContain("searchFields: receivingProductSearchFields");
    expect(receivingSource).not.toContain("exactBarcodeMatch");
    expect(inventoryRouterSource).toContain("searchFields: z.array(inventoryProductSearchFieldSchema).optional()");
    expect(inventoryRouterSource).toContain("buildInventoryProductSearchWhere(searchTokens, input.searchFields)");
  });

  it("opens product edit from receiving and returns through the preserved draft", async () => {
    const receivingSource = await readSource("src/app/(app)/inventory/receiving/page.tsx");
    const productDetailSource = await readSource("src/app/(app)/products/[id]/page.tsx");

    expect(receivingSource).toContain("receivingEditProduct");
    expect(receivingSource).toContain("handleEditProduct");
    expect(receivingSource).toContain("router.push(`/products/${result.product.id}?");
    expect(receivingSource).toContain("lastFocusedElementRef");
    expect(productDetailSource).toContain("useSearchParams");
    expect(productDetailSource).toContain("productEditReceivingReturnSource");
    expect(productDetailSource).toContain("resolveSafeReturnTo");
    expect(productDetailSource).toContain("buildReturnPath");
    expect(productDetailSource).toContain("trpcUtils.inventory.searchProducts.invalidate()");
    expect(productDetailSource).toContain("router.push(productEditReturnPath)");
  });
});
