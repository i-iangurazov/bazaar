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

  it("sends selected export columns to the server instead of slicing CSV indexes locally", async () => {
    const pageSource = await readSource("src/app/(app)/products/page.tsx");
    const schemaSource = await readSource("src/server/trpc/routers/products.schemas.ts");
    const serviceSource = await readSource("src/server/services/products/read.ts");

    expect(schemaSource).toContain("productExportColumnKeyEnum");
    expect(schemaSource).toContain("columns:");
    expect(pageSource).toContain("columns: selectedExportColumns.length");
    expect(pageSource).not.toContain("const indexes = productExportColumnKeys");
    expect(serviceSource).toContain("selectedColumns.map((column) => column.header)");
    expect(serviceSource).toContain("selectedColumns.map((column) => column.key)");
  });

  it("keeps variant sale prices in the product form contract", async () => {
    const formSource = await readSource("src/components/product-form.tsx");
    const detailSource = await readSource("src/app/(app)/products/[id]/page.tsx");
    const serviceSource = await readSource("src/server/services/products.ts");

    expect(formSource).toContain("storePriceKgs?: number");
    expect(formSource).toContain('name={`variants.${variant.index}.storePriceKgs`}');
    expect(formSource).toContain("storePriceKgs: submitMoneyToKgs");
    expect(detailSource).toContain("storeId: selectedSettingsStore?.storeId");
    expect(serviceSource).toContain("upsertStoreVariantPrices");
    expect(serviceSource).toContain("variantKey: variant.id");
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
    expect(listSource).toContain(
      "if (!enableBarcode || !selectedList.length || !canManageProducts)",
    );
    expect(createSource).toContain(
      'const canManageProducts = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";',
    );
    expect(createSource).toContain('status === "authenticated" && canManageProducts');
    expect(detailSource).toContain(
      'const canManageProducts = role === "ADMIN" || role === "MANAGER";',
    );
    expect(detailSource).toContain("const productActions = canManageProducts ? (");
    expect(detailSource).toContain("{canManageProducts ? (\n        <ProductEditorSaveBar");
    expect(createSource).toContain(
      "const [productFormDirty, setProductFormDirty] = useState(false);",
    );
    expect(createSource).toContain('t("saveBarNewProduct")');
    expect(createSource).toContain('t("saveBarUnsavedProduct")');
    expect(createSource).toContain("onDirtyChange={setProductFormDirty}");
    expect(detailSource).toContain(
      "const productEditorDirty = productFormDirty || basePriceDraftDirty;",
    );
    expect(detailSource).toContain('t("saveBarSaved")');
    expect(detailSource).toContain('t("saveBarUnsavedChanges")');
    expect(detailSource).toContain("onDirtyChange={setProductFormDirty}");
    expect(detailSource).toContain("savedRevision={productFormSavedRevision}");
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

  it("wires store-scoped product behavior settings through product screens", async () => {
    const listSource = await readSource("src/app/(app)/products/page.tsx");
    const createSource = await readSource("src/app/(app)/products/new/page.tsx");
    const detailSource = await readSource("src/app/(app)/products/[id]/page.tsx");
    const formSource = await readSource("src/components/product-form.tsx");
    const storeRouterSource = await readSource("src/server/trpc/routers/stores.ts");
    const productServiceSource = await readSource("src/server/services/products.ts");

    expect(storeRouterSource).toContain("updateProductSettings");
    expect(storeRouterSource).toContain("adminOrOrgOwnerProcedure");
    expect(createSource).toContain("enableSku={enableSku}");
    expect(createSource).toContain("enableBarcode={enableBarcode}");
    expect(createSource).toContain("trpcUtils.products.suggestSku.invalidate()");
    expect(listSource).toContain("const productSearchPlaceholder = useMemo");
    expect(listSource).toContain('return t("searchPlaceholderNameOnly");');
    expect(listSource).toContain("placeholder={productSearchPlaceholder}");
    expect(detailSource).toContain("enableSimilarProductCheck={enableSimilarProductCheck}");
    expect(detailSource).toContain("handleSaveStoreVariantOnHand");
    expect(listSource).toContain("duplicateDialogTitle");
    expect(listSource).toContain("copyImages: false");
    expect(formSource).toContain("enableSimilarProductCheck &&");
    expect(formSource).toContain("{enableSku ? (");
    expect(formSource).toContain("{compactCreate && enableBarcode ? (");
    expect(formSource).toContain(
      "{!compactCreate && enableBarcode ? barcodeManagementSection : null}",
    );
    expect(formSource).toContain("!enableSku || !variant.sku?.trim()");
    expect(productServiceSource).toContain("copyImages ? source.photoUrl : null");
    expect(productServiceSource).toContain("sku: null");
  });

  it("exposes store-scoped product behavior settings on the profile page", async () => {
    const profileSource = await readSource("src/app/(app)/settings/profile/page.tsx");
    const orgSettingsSource = await readSource("src/server/services/orgSettings.ts");
    const storeRouterSource = await readSource("src/server/trpc/routers/stores.ts");
    const providersSource = await readSource("src/app/providers.tsx");
    const signOutSource = await readSource("src/components/signout-button.tsx");

    expect(profileSource).toContain('t("productSettings.title")');
    expect(profileSource).not.toContain('prefix: "products-table-state"');
    expect(profileSource).not.toContain("productSettingsStoreReady");
    expect(profileSource).toContain(
      "businessQuery.data?.organization.id === session?.user?.organizationId",
    );
    expect(profileSource).toContain("productSettingsLoading ? (");
    expect(profileSource).toContain('name="storeId"');
    expect(profileSource).toContain("handleStoreChange(value)");
    expect(profileSource).toContain('name="enableSku"');
    expect(profileSource).toContain('name="enableBarcode"');
    expect(profileSource).toContain('name="enableSimilarProductCheck"');
    expect(profileSource).toContain('t("productSettings.storeHint")');
    expect(profileSource).toContain("trpc.stores.updateProductSettings.useMutation");
    expect(profileSource).toContain("businessData.selectedStore.enableSku ?? true");
    expect(profileSource).toContain("trpcUtils.products.bootstrap.invalidate()");
    expect(profileSource).toContain("trpcUtils.products.storePricing.invalidate()");
    expect(providersSource).toContain("QuerySessionIsolationBoundary");
    expect(providersSource).toContain("queryClient.clear()");
    expect(signOutSource).toContain("queryClient.clear()");
    expect(orgSettingsSource).toContain("enableSku: true");
    expect(orgSettingsSource).toContain("enableBarcode: true");
    expect(orgSettingsSource).toContain("enableSimilarProductCheck: true");
    expect(orgSettingsSource).toContain("requestedStoreId && !requestedStore");
    expect(storeRouterSource).toContain("updateProductSettings: adminOrOrgOwnerProcedure");
  });

  it("keeps shared mobile list pagination touch-friendly", async () => {
    const responsiveListSource = await readSource("src/components/responsive-data-list.tsx");

    expect(responsiveListSource).toContain('className="h-10 sm:h-8"');
    expect(responsiveListSource).toContain('className="h-10 w-10 sm:h-8 sm:w-8"');
  });

  it("does not show barcode UI on product edit before store settings are loaded", async () => {
    const detailSource = await readSource("src/app/(app)/products/[id]/page.tsx");

    expect(detailSource).toContain("const productSettingsLoaded = storePricingQuery.isSuccess;");
    expect(detailSource).toContain("const enableBarcode = productSettingsLoaded");
    expect(detailSource).toContain("? (selectedSettingsStore?.enableBarcode ?? true)");
    expect(detailSource).toContain("storePricingQuery.isLoading || !formValues");
  });
});
