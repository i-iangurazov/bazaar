import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("index page source layout", () => {
  it.each([
    ["products", "src/app/(app)/products/page.tsx", '<CardTitle>{t("title")}</CardTitle>'],
    [
      "inventory",
      "src/app/(app)/inventory/page.tsx",
      '<CardTitle>{t("inventoryOverview")}</CardTitle>',
    ],
  ])(
    "keeps saved views, columns and table/grid controls in one desktop row on %s",
    async (_pageName, relativePath, marker) => {
      const source = await readSource(relativePath);
      const tableHeaderStart = source.indexOf(marker);
      const tableHeaderSource = source.slice(tableHeaderStart, tableHeaderStart + 1800);

      expect(tableHeaderSource).toContain("lg:flex-row");
      expect(tableHeaderSource).toContain("lg:flex-wrap");
      expect(tableHeaderSource).toContain("lg:items-center");
      expect(tableHeaderSource).toContain("shrink-0");
      expect(tableHeaderSource).not.toContain("sm:items-end");
    },
  );

  it("chunks inventory bulk on-hand updates instead of sending huge selections in one request", async () => {
    const source = await readSource("src/app/(app)/inventory/page.tsx");
    const serviceSource = await readSource("src/server/services/inventory.ts");
    const handlerStart = source.indexOf("const handleBulkOnHandSubmit");
    const handlerSource = source.slice(handlerStart, handlerStart + 2200);

    expect(source).toContain("const BULK_ON_HAND_CHUNK_SIZE = 100");
    expect(handlerSource).toContain("index += BULK_ON_HAND_CHUNK_SIZE");
    expect(handlerSource).toContain("snapshotIds.slice(index, index + BULK_ON_HAND_CHUNK_SIZE)");
    expect(handlerSource).toContain("bulkOnHandMutation.mutateAsync");
    expect(handlerSource).toContain("setBulkOnHandProgress");
    expect(serviceSource).toContain("const BULK_SET_ON_HAND_TRANSACTION_CHUNK_SIZE = 10");
    expect(serviceSource).toContain("index += BULK_SET_ON_HAND_TRANSACTION_CHUNK_SIZE");
    expect(serviceSource).toContain("key: `${input.idempotencyKey}:${chunkIndex}`");
    expect(serviceSource).toContain("{ timeout: 10_000 }");
  });

  it("uses manager-or-admin product management gates on product create and edit screens", async () => {
    const listSource = await readSource("src/app/(app)/products/page.tsx");
    const createSource = await readSource("src/app/(app)/products/new/page.tsx");
    const detailSource = await readSource("src/app/(app)/products/[id]/page.tsx");

    expect(listSource).toContain(
      'const canManageProducts = role === "ADMIN" || role === "MANAGER";',
    );
    expect(listSource).toContain("const canSelectProducts = canManageProducts;");
    expect(listSource).toContain("if (!canManageProducts || arrangeCategoriesRunning)");
    expect(listSource).toContain("if (!selectedList.length || !canManageProducts)");
    expect(createSource).toContain(
      'const canManageProducts = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";',
    );
    expect(createSource).toContain('status === "authenticated" && canManageProducts');
    expect(detailSource).toContain(
      'const canManageProducts = role === "ADMIN" || role === "MANAGER";',
    );
    expect(detailSource).toContain("action={\n          canManageProducts ? (");
    expect(detailSource).toContain("readOnly={!canManageProducts}");
  });

  it("defaults products to latest changes first and keeps permanent delete out of product screens", async () => {
    const listSource = await readSource("src/app/(app)/products/page.tsx");
    const detailSource = await readSource("src/app/(app)/products/[id]/page.tsx");
    const readServiceSource = await readSource("src/server/services/products/read.ts");

    expect(listSource).toContain("const productsDefaultSortVersion = 4;");
    expect(listSource).toContain("migrateProductsTableState");
    expect(listSource).toContain('key: "updatedAt"');
    expect(listSource).toContain('direction: "desc"');
    expect(listSource).toContain("const createdAtResult =");
    expect(listSource).not.toContain("trpc.products.deletePermanent.useMutation");
    expect(listSource).not.toContain('key: "delete-permanent"');
    expect(detailSource).not.toContain("trpc.products.deletePermanent.useMutation");
    expect(detailSource).not.toContain("confirmDeletePermanent");
    expect(readServiceSource).toContain('const sortKey = input?.sortKey ?? "updatedAt";');
    expect(readServiceSource).toContain('const sortDirection = input?.sortDirection ?? "desc";');
  });
});
