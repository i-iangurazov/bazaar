import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("mobile inventory source", () => {
  it("uses a mobile-only task toolbar and stock filter chips without changing desktop controls", async () => {
    const source = await readSource("src/app/(app)/inventory/page.tsx");

    expect(source).toContain("data-mobile-inventory-toolbar");
    expect(source).toContain("data-mobile-inventory-actions");
    expect(source).toContain(
      'const inventoryStockFilterSchema = z.enum(["all", "lowStock", "outOfStock", "negativeStock"])',
    );
    expect(source).toContain('stockFilter: "all"');
    expect(source).toContain('className="hidden md:contents"');
    expect(source).toContain('href="/inventory/receiving"');
    expect(source).toContain('href="/inventory/counts"');
    expect(source).toContain(
      'return query ? `/inventory/transfers?${query}` : "/inventory/transfers"',
    );
    expect(source).toContain(
      'return query ? `/inventory/write-offs?${query}` : "/inventory/write-offs"',
    );
    expect(source).toContain("router.push(buildTransferHref())");
    expect(source).toContain("router.push(buildWriteOffHref())");
    expect(source).toContain('onSelect={() => openActionDialog("minStock")}');
  });

  it("keeps mobile inventory operations on manager backend procedures", async () => {
    const routerSource = await readSource("src/server/trpc/routers/inventory.ts");

    expect(routerSource).toContain(
      'const inventoryStockFilterSchema = z.enum(["all", "lowStock", "outOfStock", "negativeStock"])',
    );
    expect(routerSource).toContain("normalizeInventorySearchTokens");
    expect(routerSource).toContain("buildInventoryProductSearchWhere");
    expect(routerSource).toContain("AND: searchTokens.map");
    expect(routerSource).toContain("buildLowStockSnapshotSql");
    expect(routerSource).toContain("postStockReceiving: managerProcedure");
    expect(routerSource).toContain("postStockWriteOff: managerProcedure");
    expect(routerSource).toContain("transfer: managerProcedure");
    expect(routerSource).toContain("adjust: managerProcedure");
    expect(routerSource).toContain("assertUserCanAccessStore");
  });

  it("uses mobile cards and bottom-sheet operations for inventory and sticky mobile receiving summary", async () => {
    const inventorySource = await readSource("src/app/(app)/inventory/page.tsx");
    const receivingSource = await readSource("src/app/(app)/inventory/receiving/page.tsx");

    expect(inventorySource).toContain("renderMobile={(item) =>");
    expect(inventorySource).toContain('variant: "success" as const');
    expect(inventorySource).toContain("mobileSheet");
    expect(receivingSource).toContain('className="overflow-x-hidden pb-[15rem] md:pb-0"');
    expect(receivingSource).toContain('className="grid items-start gap-4 xl:grid-cols-2"');
    expect(receivingSource).toContain(
      "md:grid-cols-[minmax(10rem,1fr)_4.75rem_6.75rem_5.75rem_4.75rem_2.25rem]",
    );
    expect(receivingSource).toContain("data-receiving-line-row");
    expect(receivingSource).toContain("lines.map((line, index) =>");
    expect(receivingSource).toContain("const lineNumber = index + 1");
    expect(receivingSource).toContain("{lineNumber}");
    expect(receivingSource).not.toContain("lg:flex-1 lg:overflow-y-auto");
    expect(receivingSource).toContain("handleReceivingInputKeyDown");
    expect(receivingSource).toContain("focusReceivingInputElement(nextInput, true)");
    expect(receivingSource).toContain(
      "focusReceivingInput(nextLine.key, field, viewport, { selectContents: true })",
    );
    expect(receivingSource).toContain("bazaar-doc-mobile-actions");
    expect(receivingSource).toContain("bottom-[calc(4.25rem+env(safe-area-inset-bottom))]");
    expect(receivingSource).toContain("receivingProductsCountShort");
    expect(receivingSource).toContain("receivingTotalQuantityShort");
    expect(receivingSource).toContain("pb-[env(safe-area-inset-bottom)]");
  });

  it("allows transfers to assign products to the destination store", async () => {
    const transferSource = await readSource("src/app/(app)/inventory/transfers/page.tsx");
    const inventoryServiceSource = await readSource("src/server/services/inventory.ts");

    expect(transferSource).toContain("destinationStock = destination?.snapshot.onHand ?? 0");
    expect(transferSource).not.toContain('description: t("transferProductUnavailableDestination")');
    expect(inventoryServiceSource).toContain("storeId: input.fromStoreId");
    expect(inventoryServiceSource).not.toMatch(/storeId:\s*input\.toStoreId,\s*isActive:\s*true/);
  });
});
