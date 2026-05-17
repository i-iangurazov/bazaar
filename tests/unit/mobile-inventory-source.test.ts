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
    expect(source).toContain('const inventoryStockFilterSchema = z.enum(["all", "lowStock", "outOfStock", "negativeStock"])');
    expect(source).toContain('stockFilter: "all"');
    expect(source).toContain('className="hidden md:contents"');
    expect(source).toContain('href="/inventory/receiving"');
    expect(source).toContain('href="/inventory/counts"');
    expect(source).toContain('onSelect={() => openActionDialog("transfer")}');
    expect(source).toContain('onSelect={() => openActionDialog("minStock")}');
  });

  it("keeps mobile inventory operations on existing protected backend procedures", async () => {
    const routerSource = await readSource("src/server/trpc/routers/inventory.ts");

    expect(routerSource).toContain('const inventoryStockFilterSchema = z.enum(["all", "lowStock", "outOfStock", "negativeStock"])');
    expect(routerSource).toContain("buildLowStockSnapshotSql");
    expect(routerSource).toContain("postStockReceiving: adminProcedure");
    expect(routerSource).toContain("transfer: adminProcedure");
    expect(routerSource).toContain("adjust: adminProcedure");
    expect(routerSource).toContain("assertUserCanAccessStore");
  });

  it("uses mobile cards and bottom-sheet operations for inventory and sticky mobile receiving summary", async () => {
    const inventorySource = await readSource("src/app/(app)/inventory/page.tsx");
    const receivingSource = await readSource("src/app/(app)/inventory/receiving/page.tsx");

    expect(inventorySource).toContain("renderMobile={(item) =>");
    expect(inventorySource).toContain('variant: "success" as const');
    expect(inventorySource).toContain("mobileSheet");
    expect(receivingSource).toContain('className="overflow-x-hidden pb-[15rem] md:pb-0"');
    expect(receivingSource).toContain('className="hidden md:block xl:sticky xl:top-4 xl:self-start"');
    expect(receivingSource).toContain('className="hidden overflow-x-auto lg:block"');
    expect(receivingSource).toContain("fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40");
    expect(receivingSource).toContain("receivingProductsCountShort");
    expect(receivingSource).toContain("receivingTotalQuantityShort");
    expect(receivingSource).toContain("pb-[env(safe-area-inset-bottom)]");
  });
});
