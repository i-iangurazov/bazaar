import { PrismaClient, PurchaseOrderStatus, StockMovementType } from "@prisma/client";
import type { Locator, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { assertAuthenticatedE2EDatabaseUrl, authenticatedE2ESeedPrefix } from "./contract";
import {
  authenticatedMasterDataProcurementFixture,
  authenticatedMasterDataProcurementProducts,
} from "./master-data-procurement-contract";
import {
  assertCleanMutationAudit,
  attachMutationAuditOnFailure,
  expect,
  expectMasterDataProcurementHttpError,
  mutationRequestCount,
  test,
  type MasterDataProcurementMutationProcedure,
  type MasterDataProcurementPageAudit,
} from "./master-data-procurement-test-fixtures";

const fixture = authenticatedMasterDataProcurementFixture;
const datasourceUrl = assertAuthenticatedE2EDatabaseUrl(process.env.E2E_AUTH_DATABASE_URL);
const prisma = new PrismaClient({ datasourceUrl });

test.describe.configure({ mode: "serial" });

const pathname = (page: Page) => new URL(page.url()).pathname;

const assertPathname = async (page: Page, expected: string) => {
  await expect.poll(() => pathname(page)).toBe(expected);
};

const gotoDirect = async (page: Page, path: string) => {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `direct navigation to ${path} must return a document`).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);
};

const rapidClick = async (locator: Locator) => {
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled();
  await locator.evaluate((node) => {
    const button = node as HTMLButtonElement;
    button.click();
    button.click();
  });
};

const assertSingleMutation = async (
  audit: MasterDataProcurementPageAudit,
  procedure: MasterDataProcurementMutationProcedure,
  previousCount = 0,
) => {
  await expect.poll(() => mutationRequestCount(audit, procedure)).toBe(previousCount + 1);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(
    mutationRequestCount(audit, procedure),
    `${procedure} must issue exactly one mutation`,
  ).toBe(previousCount + 1);
};

const productSearch = (page: Page) =>
  page
    .locator(
      "input[placeholder='Search by SKU or name']:visible, input[placeholder='Search by name, SKU, or barcode']:visible",
    )
    .first();

const readyProductSearch = async (page: Page) => {
  await page.waitForLoadState("load");
  await expect(page.getByRole("link", { name: "Edit" }).first()).toBeVisible();
  const search = productSearch(page);
  await expect(search).toBeVisible();
  await expect(search).toBeEditable();
  return search;
};

const selectPurchaseOrderSupplier = async (page: Page) => {
  const storeTrigger = page.getByRole("combobox", { name: "Store", exact: true });
  const supplierTrigger = page.getByRole("combobox", { name: "Supplier", exact: true });
  await expect(storeTrigger).toHaveCount(1);
  await expect(supplierTrigger).toHaveCount(1);

  await storeTrigger.press("Enter");
  await page.getByRole("option", { name: fixture.storeName, exact: true }).press("Enter");
  await expect(storeTrigger).toContainText(fixture.storeName);
  await expect(supplierTrigger).not.toContainText(fixture.storeName);

  await supplierTrigger.press("Enter");
  await page.getByRole("option", { name: fixture.supplier.name, exact: true }).press("Enter");
  await expect(supplierTrigger).toContainText(fixture.supplier.name);
  await expect(storeTrigger).not.toContainText(fixture.supplier.name);
};

const openPurchaseOrderLineDialog = async (page: Page) => {
  await page.getByRole("button", { name: "Add line", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add line" });
  await expect(dialog).toBeVisible();
  return dialog;
};

const choosePurchaseOrderProduct = async (
  dialog: Locator,
  product: { name: string; sku: string },
) => {
  await dialog.getByPlaceholder("Enter product search").fill(product.sku);
  const result = dialog.getByRole("button").filter({ hasText: product.name });
  await expect(result).toHaveCount(1);
  await result.click();
};

const addPurchaseOrderLine = async (
  page: Page,
  product: { name: string; sku: string },
  qty: number,
  unitCost: number,
) => {
  const dialog = await openPurchaseOrderLineDialog(page);
  await choosePurchaseOrderProduct(dialog, product);
  await dialog.getByLabel("Order qty").fill(String(qty));
  await dialog.getByLabel("Unit cost").fill(String(unitCost));
  await dialog.getByRole("button", { name: "Add line", exact: true }).click();
  await expect(dialog).toHaveCount(0);
};

const createPurchaseOrderFromUi = async (
  page: Page,
  mutationAudit: MasterDataProcurementPageAudit,
  input: {
    product: { name: string; sku: string };
    qty: number;
    unitCost: number;
    submit: boolean;
  },
) => {
  await gotoDirect(page, "/purchase-orders");
  await page.getByRole("link", { name: "New", exact: true }).click();
  await assertPathname(page, "/purchase-orders/new");
  await selectPurchaseOrderSupplier(page);
  await addPurchaseOrderLine(page, input.product, input.qty, input.unitCost);
  await rapidClick(
    page.getByRole("button", {
      name: input.submit ? "Submit order" : "Save draft",
      exact: true,
    }),
  );
  await assertSingleMutation(mutationAudit, "purchaseOrders.create");
  await expect.poll(() => pathname(page).startsWith("/purchase-orders/")).toBe(true);
  await expect(page.getByText("Total: KGS 221.00", { exact: true })).toBeVisible();
  const purchaseOrderId = decodeURIComponent(pathname(page).slice("/purchase-orders/".length));
  expect(purchaseOrderId).toMatch(/\S/);
  return purchaseOrderId;
};

test.afterEach(async ({ mutationAudit }, testInfo) => {
  await attachMutationAuditOnFailure(testInfo, mutationAudit);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("@master-data product list/category state and duplicate warning reconcile with DB", async ({
  page,
  mutationAudit,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoDirect(page, "/products");
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();

  const search = productSearch(page);
  await search.fill(fixture.cancelProduct.sku);
  const searchedRow = page.getByRole("row").filter({ hasText: fixture.cancelProduct.name });
  await expect(searchedRow).toHaveCount(1);
  await search.fill("");

  const categoryTrigger = page.getByRole("combobox").filter({ hasText: "All categories" });
  await categoryTrigger.click();
  await page.getByRole("option", { name: fixture.category.name }).click();
  await expect(page.getByText("1-25 of 26", { exact: true }).last()).toBeVisible();

  const productTable = page.getByRole("table").first();
  await productTable.getByRole("button", { name: "Name", exact: true }).click();
  await expect(productTable.locator("tbody tr").first()).toContainText(
    authenticatedMasterDataProcurementProducts[0]!.name,
  );
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Page 2 of 2", { exact: true })).toBeVisible();
  const lastProduct = authenticatedMasterDataProcurementProducts.at(-1)!;
  const lastRow = productTable.getByRole("row").filter({ hasText: lastProduct.name });
  await expect(lastRow).toHaveCount(1);

  const reload = await page.reload({ waitUntil: "domcontentloaded" });
  expect(reload).not.toBeNull();
  expect(reload!.status()).toBeLessThan(500);
  await expect(page.getByText("Page 2 of 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: lastProduct.name })).toHaveCount(1);
  await page
    .getByRole("row")
    .filter({ hasText: lastProduct.name })
    .getByRole("link", { name: "Edit" })
    .click();
  await assertPathname(page, `/products/${lastProduct.id}`);
  await page.goBack({ waitUntil: "domcontentloaded" });
  await assertPathname(page, "/products");
  await expect(page.getByText("Page 2 of 2", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Manage categories" }).click();
  let categoryDialog = page.getByRole("dialog", { name: "Categories manage" });
  await categoryDialog
    .getByPlaceholder("Enter categories manage")
    .fill(fixture.category.name.toLowerCase());
  await expect(categoryDialog.getByText("This category already exists.")).toBeVisible();
  await expect(categoryDialog.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(mutationRequestCount(mutationAudit, "productCategories.create")).toBe(0);
  await categoryDialog.getByRole("button", { name: "Cancel" }).click();

  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const cancelledCategory = `${authenticatedE2ESeedPrefix} Cancelled Category ${suffix}`;
  await page.getByRole("button", { name: "Manage categories" }).click();
  categoryDialog = page.getByRole("dialog", { name: "Categories manage" });
  await categoryDialog.getByPlaceholder("Enter categories manage").fill(cancelledCategory);
  await categoryDialog.getByRole("button", { name: "Cancel" }).click();
  expect(
    await prisma.productCategory.count({
      where: { organizationId: fixture.organizationId, name: cancelledCategory },
    }),
  ).toBe(0);

  const createdCategory = `${authenticatedE2ESeedPrefix} Created Category ${suffix}`;
  await page.getByRole("button", { name: "Manage categories" }).click();
  categoryDialog = page.getByRole("dialog", { name: "Categories manage" });
  await categoryDialog.getByPlaceholder("Enter categories manage").fill(createdCategory);
  await categoryDialog.getByRole("button", { name: "Save" }).click();
  await assertSingleMutation(mutationAudit, "productCategories.create");
  await expect(categoryDialog.getByText(createdCategory, { exact: true })).toBeVisible();
  expect(
    await prisma.productCategory.count({
      where: { organizationId: fixture.organizationId, name: createdCategory },
    }),
  ).toBe(1);
  const createdPreference = await prisma.storeCategoryPreference.findUnique({
    where: {
      storeId_normalizedName: {
        storeId: fixture.storeId,
        normalizedName: createdCategory.toLocaleLowerCase("ru-RU"),
      },
    },
    select: { isVisibleInForms: true, isArchived: true },
  });
  expect(createdPreference).toEqual({ isVisibleInForms: true, isArchived: false });
  await categoryDialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Manage categories" }).click();
  categoryDialog = page.getByRole("dialog", { name: "Categories manage" });
  await categoryDialog.getByRole("combobox").click();
  await page.getByRole("option", { name: fixture.category.name, exact: true }).click();
  await expectMasterDataProcurementHttpError({
    page,
    audit: mutationAudit,
    procedure: "productCategories.remove",
    status: 409,
    action: async () => {
      await categoryDialog.getByRole("button", { name: "Delete", exact: true }).click();
      await assertSingleMutation(mutationAudit, "productCategories.remove");
      await expect(
        page.getByText(/Cannot delete category:.*selected-store products: 26/),
      ).toBeVisible();
    },
  });
  expect(
    await prisma.productCategory.count({
      where: {
        id: fixture.category.id,
        organizationId: fixture.organizationId,
        name: fixture.category.name,
      },
    }),
  ).toBe(1);
  expect(
    await prisma.product.count({
      where: {
        organizationId: fixture.organizationId,
        category: fixture.category.name,
        isDeleted: false,
      },
    }),
  ).toBe(26);
  await categoryDialog.getByRole("button", { name: "Cancel" }).click();

  await gotoDirect(page, "/settings/categories");
  await page.getByPlaceholder("Find category").fill(createdCategory);
  let categoryCard = page.locator(".bazaar-admin-mobile-card").filter({ hasText: createdCategory });
  await expect(categoryCard).toHaveCount(1);
  await categoryCard.getByRole("button", { name: "Archive" }).click();
  await assertSingleMutation(mutationAudit, "productCategories.setStoreVisibility");
  await page.getByRole("button", { name: /^Archived/ }).click();
  categoryCard = page.locator(".bazaar-admin-mobile-card").filter({ hasText: createdCategory });
  await expect(categoryCard).toHaveCount(1);
  await categoryCard.getByRole("button", { name: "Restore" }).click();
  await assertSingleMutation(mutationAudit, "productCategories.setStoreVisibility", 1);
  expect(
    await prisma.storeCategoryPreference.findUnique({
      where: {
        storeId_normalizedName: {
          storeId: fixture.storeId,
          normalizedName: createdCategory.toLocaleLowerCase("ru-RU"),
        },
      },
      select: { isVisibleInForms: true, isArchived: true },
    }),
  ).toEqual({ isVisibleInForms: true, isArchived: false });

  await gotoDirect(page, `/products/new?storeId=${encodeURIComponent(fixture.storeId)}`);
  await expect.poll(async () => (await page.title()).startsWith("New | ")).toBe(true);
  await page.getByLabel("SKU").fill(fixture.cancelProduct.sku);
  await page.getByLabel("Name").fill(fixture.cancelProduct.name);
  await expect(page.getByText("Duplicate exact SKU", { exact: true })).toBeVisible();
  await expect(page.getByText(fixture.cancelProduct.name, { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Back" }).click();
  await assertPathname(page, "/products");
  expect(mutationRequestCount(mutationAudit, "products.create")).toBe(0);
  expect(
    await prisma.product.count({
      where: { organizationId: fixture.organizationId, sku: fixture.cancelProduct.sku },
    }),
  ).toBe(1);
  assertCleanMutationAudit(mutationAudit);
});

test("@master-data units trim, dedupe, edit, persistence and guarded removal reconcile with DB", async ({
  page,
  mutationAudit,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoDirect(page, "/settings/units");
  await expect(page.getByRole("heading", { level: 1, name: "Units" })).toBeVisible();

  await page.getByRole("button", { name: "Units create" }).click();
  let dialog = page.getByRole("dialog", { name: "Create" });
  await dialog.getByLabel("Code").fill("   ");
  await dialog.getByLabel("Label RU").fill("   ");
  await dialog.getByLabel("Label KG").fill("   ");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("Code is required.")).toBeVisible();
  await expect(dialog.getByText("Label is required.")).toHaveCount(2);
  expect(mutationRequestCount(mutationAudit, "units.create")).toBe(0);

  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const cancelledCode = `QA-KYR-CANCEL-${suffix}`;
  await dialog.getByLabel("Code").fill(cancelledCode);
  await dialog.getByLabel("Label RU").fill("QA-BAZAAR отмененная единица");
  await dialog.getByLabel("Label KG").fill("QA-BAZAAR жокко чыгарылган өлчөм");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(
    await prisma.unit.count({
      where: { organizationId: fixture.organizationId, code: cancelledCode },
    }),
  ).toBe(0);

  await page.getByRole("button", { name: "Units create" }).click();
  dialog = page.getByRole("dialog", { name: "Create" });
  await dialog.getByLabel("Code").fill("QA-AUTH-PC");
  await dialog.getByLabel("Label RU").fill("QA-BAZAAR дубликат");
  await dialog.getByLabel("Label KG").fill("QA-BAZAAR кайталанма");
  await expectMasterDataProcurementHttpError({
    page,
    audit: mutationAudit,
    procedure: "units.create",
    status: 409,
    action: () => rapidClick(dialog.getByRole("button", { name: "Save" })),
  });
  await assertSingleMutation(mutationAudit, "units.create");
  await expect(page.getByText("Unit code exists", { exact: true })).toBeVisible();
  expect(
    await prisma.unit.count({
      where: { organizationId: fixture.organizationId, code: "QA-AUTH-PC" },
    }),
  ).toBe(1);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  const unitCode = `QA-KYR-${suffix}`;
  const labelRu = `QA-BAZAAR единица ${suffix}`;
  const labelKg = `QA-BAZAAR кыргыз өлчөмү ${suffix}`;
  await page.getByRole("button", { name: "Units create" }).click();
  dialog = page.getByRole("dialog", { name: "Create" });
  await dialog.getByLabel("Code").fill(`  ${unitCode}  `);
  await dialog.getByLabel("Label RU").fill(`  ${labelRu}  `);
  await dialog.getByLabel("Label KG").fill(`  ${labelKg}  `);
  await rapidClick(dialog.getByRole("button", { name: "Save" }));
  await assertSingleMutation(mutationAudit, "units.create", 1);
  await expect(dialog).toHaveCount(0);

  const createdUnits = await prisma.unit.findMany({
    where: { code: unitCode },
    select: { id: true, organizationId: true, code: true, labelRu: true, labelKg: true },
  });
  expect(createdUnits).toEqual([
    {
      id: expect.any(String),
      organizationId: fixture.organizationId,
      code: unitCode,
      labelRu,
      labelKg,
    },
  ]);
  const unitId = createdUnits[0]!.id;

  let unitRow = page.getByRole("row").filter({ hasText: unitCode });
  await expect(unitRow).toHaveCount(1);
  await unitRow.getByRole("button", { name: "Edit" }).click();
  dialog = page.getByRole("dialog", { name: "Edit" });
  await expect(dialog.getByLabel("Code")).toBeDisabled();
  const updatedLabelRu = `${labelRu} изменена`;
  const updatedLabelKg = `${labelKg} жаңырды`;
  await dialog.getByLabel("Label RU").fill(`  ${updatedLabelRu}  `);
  await dialog.getByLabel("Label KG").fill(`  ${updatedLabelKg}  `);
  await rapidClick(dialog.getByRole("button", { name: "Save" }));
  await assertSingleMutation(mutationAudit, "units.update");
  await expect(dialog).toHaveCount(0);
  expect(
    await prisma.unit.findUnique({
      where: { id: unitId },
      select: { organizationId: true, code: true, labelRu: true, labelKg: true },
    }),
  ).toEqual({
    organizationId: fixture.organizationId,
    code: unitCode,
    labelRu: updatedLabelRu,
    labelKg: updatedLabelKg,
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  unitRow = page.getByRole("row").filter({ hasText: unitCode });
  await expect(unitRow).toContainText(updatedLabelRu);
  await expect(unitRow).toContainText(updatedLabelKg);

  const baseUnitRow = page.getByRole("row").filter({ hasText: "QA-AUTH-PC" });
  await baseUnitRow.getByRole("button", { name: "Delete" }).click();
  let confirmDialog = page.getByRole("dialog", { name: "Confirm" });
  await expect(confirmDialog).toContainText("QA-AUTH-PC");
  await confirmDialog.getByRole("button", { name: "Cancel" }).click();
  expect(mutationRequestCount(mutationAudit, "units.remove")).toBe(0);
  expect(
    await prisma.unit.count({
      where: { id: fixture.baseUnitId, organizationId: fixture.organizationId },
    }),
  ).toBe(1);

  await baseUnitRow.getByRole("button", { name: "Delete" }).click();
  confirmDialog = page.getByRole("dialog", { name: "Confirm" });
  await expectMasterDataProcurementHttpError({
    page,
    audit: mutationAudit,
    procedure: "units.remove",
    status: 409,
    action: () => rapidClick(confirmDialog.getByRole("button", { name: "Confirm" })),
  });
  await assertSingleMutation(mutationAudit, "units.remove");
  await expect(page.getByText("Unit in use", { exact: true })).toBeVisible();
  expect(
    await prisma.product.count({
      where: { organizationId: fixture.organizationId, baseUnitId: fixture.baseUnitId },
    }),
  ).toBeGreaterThan(0);

  unitRow = page.getByRole("row").filter({ hasText: unitCode });
  await unitRow.getByRole("button", { name: "Delete" }).click();
  confirmDialog = page.getByRole("dialog", { name: "Confirm" });
  await rapidClick(confirmDialog.getByRole("button", { name: "Confirm" }));
  await assertSingleMutation(mutationAudit, "units.remove", 1);
  await expect(unitRow).toHaveCount(0);
  expect(await prisma.unit.count({ where: { id: unitId } })).toBe(0);
  assertCleanMutationAudit(mutationAudit);
});

test("@master-data attributes trim, dedupe, edit, persistence and all usage guards reconcile with DB", async ({
  page,
  mutationAudit,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoDirect(page, "/settings/attributes");
  await expect(page.getByRole("heading", { level: 1, name: "Attributes" })).toBeVisible();

  await page.getByRole("button", { name: "Add attribute" }).click();
  let dialog = page.getByRole("dialog", { name: "Create" });
  await dialog.getByLabel("Key").fill("   ");
  await dialog.getByLabel("Label RU").fill("   ");
  await dialog.getByLabel("Label KG").fill("   ");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("Key is required.")).toBeVisible();
  await expect(dialog.getByText("Label is required.")).toHaveCount(2);
  expect(mutationRequestCount(mutationAudit, "attributes.create")).toBe(0);

  const suffix = `${Date.now()}_${test.info().workerIndex}`;
  const cancelledKey = `qa_cancel_${suffix}`;
  await dialog.getByLabel("Key").fill(cancelledKey);
  await dialog.getByLabel("Label RU").fill("QA-BAZAAR отмененный атрибут");
  await dialog.getByLabel("Label KG").fill("QA-BAZAAR жокко чыгарылган атрибут");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(
    await prisma.attributeDefinition.count({
      where: { organizationId: fixture.organizationId, key: cancelledKey },
    }),
  ).toBe(0);

  await page.getByRole("button", { name: "Add attribute" }).click();
  dialog = page.getByRole("dialog", { name: "Create" });
  await dialog.getByLabel("Key").fill(`  ${fixture.attribute.key.toUpperCase()}  `);
  await dialog.getByLabel("Label RU").fill("QA-BAZAAR дубликат");
  await dialog.getByLabel("Label KG").fill("QA-BAZAAR кайталанма");
  await expectMasterDataProcurementHttpError({
    page,
    audit: mutationAudit,
    procedure: "attributes.create",
    status: 409,
    action: () => rapidClick(dialog.getByRole("button", { name: "Save" })),
  });
  await assertSingleMutation(mutationAudit, "attributes.create");
  await expect(page.getByText("Attribute exists", { exact: true })).toBeVisible();
  expect(
    await prisma.attributeDefinition.count({
      where: { organizationId: fixture.organizationId, key: fixture.attribute.key },
    }),
  ).toBe(1);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  const attributeKey = `qa_kyr_${suffix}`;
  const labelRu = `QA-BAZAAR характеристика ${suffix}`;
  const labelKg = `QA-BAZAAR кыргыз мүнөздөмөсү ${suffix}`;
  await page.getByRole("button", { name: "Add attribute" }).click();
  dialog = page.getByRole("dialog", { name: "Create" });
  await dialog.getByLabel("Key").fill(`  ${attributeKey.toUpperCase()}  `);
  await dialog.getByLabel("Label RU").fill(`  ${labelRu}  `);
  await dialog.getByLabel("Label KG").fill(`  ${labelKg}  `);
  await rapidClick(dialog.getByRole("button", { name: "Save" }));
  await assertSingleMutation(mutationAudit, "attributes.create", 1);
  await expect(dialog).toHaveCount(0);

  const createdAttributes = await prisma.attributeDefinition.findMany({
    where: { key: attributeKey },
    select: { id: true, organizationId: true, key: true, labelRu: true, labelKg: true },
  });
  expect(createdAttributes).toEqual([
    {
      id: expect.any(String),
      organizationId: fixture.organizationId,
      key: attributeKey,
      labelRu,
      labelKg,
    },
  ]);
  const attributeId = createdAttributes[0]!.id;

  let attributeRow = page.getByRole("row").filter({ hasText: attributeKey });
  await expect(attributeRow).toHaveCount(1);
  await attributeRow.getByRole("button", { name: "Edit" }).click();
  dialog = page.getByRole("dialog", { name: "Edit" });
  const updatedKey = `${attributeKey}_edited`;
  const updatedLabelRu = `${labelRu} изменена`;
  const updatedLabelKg = `${labelKg} жаңырды`;
  await dialog.getByLabel("Key").fill(`  ${updatedKey.toUpperCase()}  `);
  await dialog.getByLabel("Label RU").fill(`  ${updatedLabelRu}  `);
  await dialog.getByLabel("Label KG").fill(`  ${updatedLabelKg}  `);
  await rapidClick(dialog.getByRole("button", { name: "Save" }));
  await assertSingleMutation(mutationAudit, "attributes.update");
  await expect(dialog).toHaveCount(0);
  expect(
    await prisma.attributeDefinition.findUnique({
      where: { id: attributeId },
      select: { organizationId: true, key: true, labelRu: true, labelKg: true },
    }),
  ).toEqual({
    organizationId: fixture.organizationId,
    key: updatedKey,
    labelRu: updatedLabelRu,
    labelKg: updatedLabelKg,
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  attributeRow = page.getByRole("row").filter({ hasText: updatedKey });
  await expect(attributeRow).toContainText(updatedLabelKg);

  const inUseRow = page.getByRole("row").filter({ hasText: fixture.attribute.key });
  await rapidClick(inUseRow.getByRole("button", { name: "Remove" }));
  let confirmDialog = page.getByRole("dialog", { name: "Confirm" });
  await expectMasterDataProcurementHttpError({
    page,
    audit: mutationAudit,
    procedure: "attributes.remove",
    status: 409,
    action: () => rapidClick(confirmDialog.getByRole("button", { name: "Confirm" })),
  });
  await assertSingleMutation(mutationAudit, "attributes.remove");
  await expect(page.getByText("Attribute in use", { exact: true })).toBeVisible();
  expect(
    await prisma.attributeDefinition.count({
      where: {
        id: fixture.attribute.id,
        organizationId: fixture.organizationId,
        key: fixture.attribute.key,
      },
    }),
  ).toBe(1);
  expect(
    await prisma.productVariant.findUnique({
      where: { id: fixture.attribute.variantId },
      select: { productId: true, attributes: true },
    }),
  ).toEqual({
    productId: fixture.attribute.productId,
    attributes: { [fixture.attribute.key]: fixture.attribute.value },
  });
  expect(
    await prisma.variantAttributeValue.count({
      where: {
        id: fixture.attribute.valueId,
        organizationId: fixture.organizationId,
        productId: fixture.attribute.productId,
        variantId: fixture.attribute.variantId,
        key: fixture.attribute.key,
      },
    }),
  ).toBe(1);

  attributeRow = page.getByRole("row").filter({ hasText: updatedKey });
  await attributeRow.getByRole("button", { name: "Remove" }).click();
  confirmDialog = page.getByRole("dialog", { name: "Confirm" });
  await rapidClick(confirmDialog.getByRole("button", { name: "Confirm" }));
  await assertSingleMutation(mutationAudit, "attributes.remove", 1);
  await expect(attributeRow).toHaveCount(0);
  expect(await prisma.attributeDefinition.count({ where: { id: attributeId } })).toBe(0);
  assertCleanMutationAudit(mutationAudit);
});

test("@master-data supplier validation, cancel, create, edit, search and refresh are durable", async ({
  page,
  mutationAudit,
}) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const cancelledName = `${authenticatedE2ESeedPrefix} Cancelled Supplier ${suffix}`;
  const createdName = `${authenticatedE2ESeedPrefix} UI Supplier ${suffix}`;
  const updatedName = `${createdName} Edited`;

  await gotoDirect(page, "/suppliers");
  await page.getByRole("button", { name: "Add supplier" }).click();
  let dialog = page.getByRole("dialog", { name: "New supplier" });
  await dialog.getByLabel("Name").fill("A");
  await dialog.getByRole("button", { name: "Create supplier" }).click();
  await expect(dialog.getByText("Name must contain at least 2 characters.")).toBeVisible();
  expect(mutationRequestCount(mutationAudit, "suppliers.create")).toBe(0);
  await dialog.getByLabel("Name").fill(cancelledName);
  const discardDialogPromise = page.waitForEvent("dialog");
  const cancelPromise = dialog.getByRole("button", { name: "Cancel" }).click();
  const discardDialog = await discardDialogPromise;
  expect(discardDialog.type()).toBe("confirm");
  expect(discardDialog.message()).toBe("Discard your unsaved changes?");
  await discardDialog.accept();
  await cancelPromise;
  await expect(dialog).toHaveCount(0);
  expect(
    await prisma.supplier.count({
      where: { organizationId: fixture.organizationId, name: cancelledName },
    }),
  ).toBe(0);

  await page.getByRole("button", { name: "Add supplier" }).click();
  dialog = page.getByRole("dialog", { name: "New supplier" });
  await dialog.getByLabel("Name").fill(`  ${createdName}  `);
  await dialog.getByLabel("Email").fill("");
  await dialog.getByLabel("Phone").fill(" +996 555 123 987 ");
  await rapidClick(dialog.getByRole("button", { name: "Create supplier" }));
  await assertSingleMutation(mutationAudit, "suppliers.create");
  await expect(dialog).toHaveCount(0);

  const created = await prisma.supplier.findMany({
    where: { organizationId: fixture.organizationId, name: createdName },
    select: { id: true, email: true, phone: true, notes: true },
  });
  expect(created).toEqual([
    {
      id: expect.any(String),
      email: null,
      phone: "+996 555 123 987",
      notes: null,
    },
  ]);
  const supplierId = created[0]!.id;

  const search = page.getByRole("searchbox", { name: "Search" });
  await search.fill(createdName);
  let supplierRow = page.getByRole("row").filter({ hasText: createdName });
  await expect(supplierRow).toHaveCount(1);
  await supplierRow.getByRole("button", { name: "Edit" }).click();
  dialog = page.getByRole("dialog", { name: "Edit supplier" });
  await dialog.getByLabel("Name").fill(updatedName);
  await dialog.getByLabel("Email").fill("qa-bazaar-updated@auth-e2e.test");
  await dialog.getByLabel("Notes").fill("  procurement acceptance  ");
  await rapidClick(dialog.getByRole("button", { name: "Save supplier" }));
  await assertSingleMutation(mutationAudit, "suppliers.update");
  await expect(dialog).toHaveCount(0);
  expect(
    await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { name: true, email: true, phone: true, notes: true },
    }),
  ).toEqual({
    name: updatedName,
    email: "qa-bazaar-updated@auth-e2e.test",
    phone: "+996 555 123 987",
    notes: "procurement acceptance",
  });

  const reload = await page.reload({ waitUntil: "domcontentloaded" });
  expect(reload).not.toBeNull();
  expect(reload!.status()).toBeLessThan(500);
  supplierRow = page.getByRole("row").filter({ hasText: updatedName });
  await expect(supplierRow).toHaveCount(1);
  assertCleanMutationAudit(mutationAudit);
});

test("@master-data mobile product lookup, create and edit persist", async ({
  page,
  mutationAudit,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoDirect(page, "/products");
  await (await readyProductSearch(page)).fill(fixture.cancelProduct.sku);
  await expect(
    page.getByText(fixture.cancelProduct.name, { exact: true }).filter({ visible: true }),
  ).toBeVisible();

  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const sku = `${authenticatedE2ESeedPrefix}-MOBILE-${suffix}`;
  const name = `${authenticatedE2ESeedPrefix} Mobile Product ${suffix}`;
  const updatedName = `${name} Edited`;
  await gotoDirect(page, `/products/new?storeId=${encodeURIComponent(fixture.storeId)}`);
  await page.getByLabel("SKU").fill(sku);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Sale price").fill("175");
  await page.getByLabel("Cost").fill("50");
  await page.getByLabel("Initial stock").fill("2");
  await rapidClick(page.getByRole("button", { name: "Products save" }).first());
  await assertSingleMutation(mutationAudit, "products.create");
  await assertPathname(page, "/products");

  const product = await prisma.product.findFirst({
    where: { organizationId: fixture.organizationId, sku },
    select: { id: true, name: true },
  });
  expect(product).toEqual({ id: expect.any(String), name });
  await (await readyProductSearch(page)).fill(sku);
  await expect(page.getByText(name, { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole("link", { name: "Edit" }).click();
  await assertPathname(page, `/products/${product!.id}`);
  await page.getByLabel("Name").fill(updatedName);
  await rapidClick(page.getByRole("button", { name: "Products save" }).first());
  await assertSingleMutation(mutationAudit, "products.update");
  await assertPathname(page, "/products");
  expect(
    await prisma.product.findUnique({
      where: { id: product!.id },
      select: { name: true, sku: true },
    }),
  ).toEqual({ name: updatedName, sku });

  await (await readyProductSearch(page)).fill(sku);
  await expect(
    page.getByText(updatedName, { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Edit" }).click();
  await assertPathname(page, `/products/${product!.id}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(updatedName);
  await page.getByRole("link", { name: "Back" }).click();
  await assertPathname(page, "/products");
  await expect(
    page.getByText(updatedName, { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  assertCleanMutationAudit(mutationAudit);
});

test("@procurement draft validation, edit, PDF, list Back and cancel reconcile with DB", async ({
  page,
  mutationAudit,
}) => {
  await gotoDirect(page, "/purchase-orders/new");
  await selectPurchaseOrderSupplier(page);
  let lineDialog = await openPurchaseOrderLineDialog(page);
  await choosePurchaseOrderProduct(lineDialog, fixture.cancelProduct);
  await lineDialog.getByLabel("Order qty").fill("0");
  await lineDialog.getByRole("button", { name: "Add line", exact: true }).click();
  await expect(lineDialog.getByText("Qty positive", { exact: true })).toBeVisible();
  await lineDialog.getByLabel("Order qty").fill("2");
  await lineDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(lineDialog).toHaveCount(0);
  expect(mutationRequestCount(mutationAudit, "purchaseOrders.create")).toBe(0);
  await expect(page.getByText("No lines", { exact: true })).toBeVisible();

  await addPurchaseOrderLine(page, fixture.cancelProduct, 4, 55.25);
  lineDialog = await openPurchaseOrderLineDialog(page);
  await choosePurchaseOrderProduct(lineDialog, fixture.cancelProduct);
  await lineDialog.getByRole("button", { name: "Add line", exact: true }).click();
  await expect(page.getByText("This item is already in the order.", { exact: true })).toBeVisible();
  await lineDialog.getByRole("button", { name: "Cancel" }).click();

  await rapidClick(page.getByRole("button", { name: "Save draft", exact: true }));
  await assertSingleMutation(mutationAudit, "purchaseOrders.create");
  await expect.poll(() => pathname(page).startsWith("/purchase-orders/")).toBe(true);
  const purchaseOrderId = decodeURIComponent(pathname(page).slice("/purchase-orders/".length));
  let purchaseOrder = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { lines: true },
  });
  expect(purchaseOrder).toMatchObject({
    organizationId: fixture.organizationId,
    storeId: fixture.storeId,
    supplierId: fixture.supplier.id,
    status: PurchaseOrderStatus.DRAFT,
    lines: [
      expect.objectContaining({
        productId: fixture.cancelProduct.id,
        qtyOrdered: 4,
        qtyReceived: 0,
      }),
    ],
  });
  expect(Number(purchaseOrder!.lines[0]!.unitCost)).toBe(55.25);

  const pdfResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/purchase-orders/${purchaseOrderId}/pdf`,
  );
  const pdfDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  const [pdfResponse, pdfDownload] = await Promise.all([pdfResponsePromise, pdfDownloadPromise]);
  expect(pdfResponse.status()).toBe(200);
  expect(pdfResponse.headers()["content-type"]).toContain("application/pdf");
  await pdfResponse.finished();
  expect(pdfDownload.suggestedFilename()).toBe(`po-${purchaseOrderId}.pdf`);
  const pdfPath = await pdfDownload.path();
  expect(pdfPath).not.toBeNull();
  expect((await readFile(pdfPath!)).length).toBeGreaterThan(500);

  let orderRow = page.getByRole("row").filter({ hasText: fixture.cancelProduct.name });
  await orderRow.getByRole("button", { name: "Edit line" }).click();
  lineDialog = page.getByRole("dialog", { name: "Edit line" });
  await lineDialog.getByLabel("Order qty").fill("9");
  await lineDialog.getByRole("button", { name: "Cancel" }).click();
  expect(mutationRequestCount(mutationAudit, "purchaseOrders.updateLine")).toBe(0);
  expect(
    await prisma.purchaseOrderLine.findFirst({
      where: { purchaseOrderId, productId: fixture.cancelProduct.id },
      select: { qtyOrdered: true },
    }),
  ).toEqual({ qtyOrdered: 4 });

  orderRow = page.getByRole("row").filter({ hasText: fixture.cancelProduct.name });
  await orderRow.getByRole("button", { name: "Edit line" }).click();
  lineDialog = page.getByRole("dialog", { name: "Edit line" });
  await lineDialog.getByLabel("Order qty").fill("6");
  await lineDialog.getByLabel("Unit cost").fill("56.25");
  await lineDialog.getByRole("button", { name: "Save line" }).click();
  await assertSingleMutation(mutationAudit, "purchaseOrders.updateLine");
  await expect(lineDialog).toHaveCount(0);
  purchaseOrder = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { lines: true },
  });
  expect(purchaseOrder!.lines[0]!.qtyOrdered).toBe(6);
  expect(Number(purchaseOrder!.lines[0]!.unitCost)).toBe(56.25);

  await page.reload({ waitUntil: "domcontentloaded" });
  orderRow = page.getByRole("row").filter({ hasText: fixture.cancelProduct.name });
  await expect(orderRow).toContainText("6");
  await gotoDirect(page, "/purchase-orders");
  const listSearch = page.getByPlaceholder("Search by number, supplier, or store");
  await listSearch.fill(purchaseOrderId);
  await expect.poll(() => new URL(page.url()).searchParams.get("search")).toBe(purchaseOrderId);
  let listRow = page
    .getByRole("row")
    .filter({ hasText: purchaseOrderId.slice(0, 8).toUpperCase() });
  await expect(listRow).toHaveCount(1);
  await listRow.getByRole("link", { name: fixture.supplier.name }).click();
  await assertPathname(page, `/purchase-orders/${purchaseOrderId}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("row").filter({ hasText: fixture.cancelProduct.name })).toContainText(
    "6",
  );
  await page.goBack({ waitUntil: "domcontentloaded" });
  await assertPathname(page, "/purchase-orders");
  await expect(listSearch).toHaveValue(purchaseOrderId);
  listRow = page.getByRole("row").filter({ hasText: purchaseOrderId.slice(0, 8).toUpperCase() });
  await listRow.getByRole("button", { name: "Cancel order" }).click();
  const confirmDialog = page.getByRole("dialog", { name: "Confirm" });
  await confirmDialog.getByRole("button", { name: "Confirm" }).click();
  await assertSingleMutation(mutationAudit, "purchaseOrders.cancel");
  await expect(listRow).toContainText("Cancelled");

  expect(
    await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: { status: true },
    }),
  ).toEqual({ status: PurchaseOrderStatus.CANCELLED });
  expect(
    await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: fixture.storeId,
          productId: fixture.cancelProduct.id,
          variantKey: fixture.variantKey,
        },
      },
      select: { onHand: true, onOrder: true },
    }),
  ).toEqual({ onHand: fixture.cancelProduct.baselineOnHand, onOrder: 0 });
  expect(
    await prisma.stockMovement.count({
      where: { referenceType: "PURCHASE_ORDER", referenceId: purchaseOrderId },
    }),
  ).toBe(0);
  assertCleanMutationAudit(mutationAudit);
});

test("@procurement submitted PO approves, receives and links supplier, movement and inventory", async ({
  page,
  mutationAudit,
}) => {
  const product = fixture.receiveProduct;
  const purchaseOrderId = await createPurchaseOrderFromUi(page, mutationAudit, {
    product,
    qty: product.purchaseQty,
    unitCost: product.purchaseUnitCostKgs,
    submit: true,
  });
  await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
  expect(
    await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: fixture.storeId,
          productId: product.id,
          variantKey: fixture.variantKey,
        },
      },
      select: { onHand: true, onOrder: true },
    }),
  ).toEqual({ onHand: product.baselineOnHand, onOrder: product.purchaseQty });

  await page.getByRole("button", { name: "Approve order" }).click();
  await assertSingleMutation(mutationAudit, "purchaseOrders.approve");
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Receive items" }).click();
  const receiveDialog = page.getByRole("dialog", { name: "Receive items" });
  const receiveRow = receiveDialog.getByRole("row").filter({ hasText: product.name });
  await expect(receiveRow.getByRole("spinbutton")).toHaveValue(String(product.purchaseQty));
  await receiveDialog.getByRole("button", { name: "Receive submit" }).click();
  await assertSingleMutation(mutationAudit, "purchaseOrders.receive");
  await expect(page.getByText("Received", { exact: true })).toBeVisible();

  const receivedOrder = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { supplier: true, lines: true },
  });
  expect(receivedOrder).toMatchObject({
    organizationId: fixture.organizationId,
    storeId: fixture.storeId,
    supplierId: fixture.supplier.id,
    status: PurchaseOrderStatus.RECEIVED,
    supplier: { id: fixture.supplier.id, name: fixture.supplier.name },
    lines: [
      expect.objectContaining({
        productId: product.id,
        qtyOrdered: product.purchaseQty,
        qtyReceived: product.purchaseQty,
      }),
    ],
  });
  expect(receivedOrder!.submittedAt).not.toBeNull();
  expect(receivedOrder!.approvedAt).not.toBeNull();
  expect(receivedOrder!.receivedAt).not.toBeNull();

  expect(
    await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: fixture.storeId,
          productId: product.id,
          variantKey: fixture.variantKey,
        },
      },
      select: { onHand: true, onOrder: true },
    }),
  ).toEqual({
    onHand: product.baselineOnHand + product.purchaseQty,
    onOrder: 0,
  });
  const movement = await prisma.stockMovement.findMany({
    where: { referenceType: "PURCHASE_ORDER", referenceId: purchaseOrderId },
    select: {
      storeId: true,
      productId: true,
      type: true,
      qtyDelta: true,
      unitCostKgs: true,
      lineTotalKgs: true,
      inventoryValueDeltaKgs: true,
    },
  });
  expect(movement).toHaveLength(1);
  expect(movement[0]).toMatchObject({
    storeId: fixture.storeId,
    productId: product.id,
    type: StockMovementType.RECEIVE,
    qtyDelta: product.purchaseQty,
  });
  expect(Number(movement[0]!.unitCostKgs)).toBe(product.purchaseUnitCostKgs);
  expect(Number(movement[0]!.lineTotalKgs)).toBe(product.purchaseQty * product.purchaseUnitCostKgs);
  expect(Number(movement[0]!.inventoryValueDeltaKgs)).toBe(
    product.purchaseQty * product.purchaseUnitCostKgs,
  );
  const productCost = await prisma.productCost.findUnique({
    where: {
      organizationId_productId_variantKey: {
        organizationId: fixture.organizationId,
        productId: product.id,
        variantKey: fixture.variantKey,
      },
    },
    select: { avgCostKgs: true, costBasisQty: true, costBasisValueKgs: true },
  });
  expect(productCost!.costBasisQty).toBe(product.baselineOnHand + product.purchaseQty);
  expect(Number(productCost!.costBasisValueKgs)).toBe(
    product.baselineOnHand * product.unitCostKgs +
      product.purchaseQty * product.purchaseUnitCostKgs,
  );
  expect(Number(productCost!.avgCostKgs)).toBe(43.41);

  await gotoDirect(
    page,
    `/inventory/movements/PURCHASE_ORDER:PURCHASE_ORDER:${encodeURIComponent(purchaseOrderId)}`,
  );
  await expect(page.getByRole("heading", { level: 3, name: "Movement lines" })).toBeVisible();
  const movementRow = page.getByRole("row").filter({ hasText: product.name });
  await expect(movementRow).toHaveCount(1);
  await expect(movementRow).toContainText(String(product.purchaseQty));
  await expect(movementRow).toContainText("52.50");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("row").filter({ hasText: product.name })).toHaveCount(1);
  assertCleanMutationAudit(mutationAudit);
});
