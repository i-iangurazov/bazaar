import { PrismaClient, StockCountStatus, StockMovementType } from "@prisma/client";
import type { Locator, Page } from "@playwright/test";

import { assertAuthenticatedE2EDatabaseUrl, authenticatedE2ESeedPrefix } from "./contract";
import { authenticatedInventoryMutationFixture } from "./inventory-mutations-contract";
import {
  assertCleanMutationAudit,
  attachMutationAuditOnFailure,
  expect,
  mutationRequestCount,
  test,
  type AuthenticatedMutationProcedure,
  type MutationPageAudit,
} from "./mutation-test-fixtures";

const fixture = authenticatedInventoryMutationFixture;
const primaryStoreName = `${authenticatedE2ESeedPrefix} Primary Store`;
const secondaryStoreName = `${authenticatedE2ESeedPrefix} Secondary Store`;
const datasourceUrl = assertAuthenticatedE2EDatabaseUrl(process.env.E2E_AUTH_DATABASE_URL);
const prisma = new PrismaClient({ datasourceUrl });

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
  audit: MutationPageAudit,
  procedure: AuthenticatedMutationProcedure,
  previousCount = 0,
) => {
  await expect.poll(() => mutationRequestCount(audit, procedure)).toBe(previousCount + 1);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(
    mutationRequestCount(audit, procedure),
    `${procedure} must issue exactly one mutation after a rapid double click`,
  ).toBe(previousCount + 1);
};

const assertNoBlockingUi = async (page: Page) => {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[aria-busy='true'], [data-loading='true']")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement;
        return Boolean(active?.isConnected && active.getAttribute("aria-hidden") !== "true");
      }),
    )
    .toBe(true);
};

const assertNoRootOverflow = async (page: Page) => {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.documentElement;
        const body = document.body;
        return Math.max(root.scrollWidth, body.scrollWidth) <= window.innerWidth + 1;
      }),
    )
    .toBe(true);
};

const snapshotOnHand = async (storeId: string, productId: string) => {
  const snapshot = await prisma.inventorySnapshot.findUnique({
    where: {
      storeId_productId_variantKey: { storeId, productId, variantKey: fixture.variantKey },
    },
    select: { onHand: true },
  });
  expect(snapshot, `inventory snapshot for ${storeId}/${productId}`).not.toBeNull();
  return snapshot!.onHand;
};

const movementReferenceFromPage = (page: Page, documentType: string) => {
  const prefix = "/inventory/movements/";
  const currentPath = pathname(page);
  expect(currentPath.startsWith(prefix)).toBe(true);
  const documentKey = decodeURIComponent(currentPath.slice(prefix.length));
  const [actualDocumentType, referenceType, referenceId, ...unexpected] = documentKey.split(":");
  expect(actualDocumentType).toBe(documentType);
  expect(referenceType).toBe(documentType);
  expect(unexpected).toEqual([]);
  expect(referenceId).toMatch(/\S/);
  return { currentPath, referenceId };
};

const assertMovementDetail = async (
  page: Page,
  productName: string,
  expectedRows: Array<{ storeName: string; quantity: string }>,
) => {
  await expect(page.getByRole("heading", { level: 3, name: "Movement lines" })).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.locator("tbody tr")).toHaveCount(expectedRows.length);
  for (const expectedRow of expectedRows) {
    const row = table.getByRole("row").filter({ hasText: expectedRow.storeName });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(productName);
    await expect(row.getByRole("cell").nth(3)).toHaveText(expectedRow.quantity);
  }
};

const assertReloadAndMovementBack = async (
  page: Page,
  detailPath: string,
  productName: string,
  expectedRows: Array<{ storeName: string; quantity: string }>,
) => {
  const response = await page.reload({ waitUntil: "domcontentloaded" });
  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);
  await assertPathname(page, detailPath);
  await assertMovementDetail(page, productName, expectedRows);
  await assertNoBlockingUi(page);

  await page.getByRole("link", { name: "Back to Product Movement" }).click();
  await assertPathname(page, "/inventory/movements");
  await expect(page.getByRole("heading", { level: 1, name: "Product Movement" })).toBeVisible();
  await page.goBack({ waitUntil: "domcontentloaded" });
  await assertPathname(page, detailPath);
  await assertMovementDetail(page, productName, expectedRows);
};

test.afterEach(async ({ mutationAudit }, testInfo) => {
  await attachMutationAuditOnFailure(testInfo, mutationAudit);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("@inventory-mutations product create and edit settle once and remain navigable", async ({
  page,
  mutationAudit,
}) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const sku = `${authenticatedE2ESeedPrefix}-UI-${suffix}`;
  const originalName = `${authenticatedE2ESeedPrefix} UI Product ${suffix}`;
  const updatedName = `${originalName} Edited`;

  await gotoDirect(page, `/products/new?storeId=${encodeURIComponent(fixture.primaryStoreId)}`);
  await assertPathname(page, "/products/new");
  await expect(page.getByRole("heading", { level: 1, name: "New" })).toBeVisible();
  await page.getByLabel("SKU").fill(sku);
  await page.getByLabel("Name").fill(originalName);
  await page.getByLabel("Sale price").fill("175");
  await page.getByLabel("Initial stock").fill("7");
  await rapidClick(page.getByRole("button", { name: "Products save" }).first());

  await assertPathname(page, "/products");
  await assertSingleMutation(mutationAudit, "products.create");
  await assertNoBlockingUi(page);

  const createdProducts = await prisma.product.findMany({
    where: { organizationId: fixture.organizationId, sku },
    select: { id: true, name: true },
  });
  expect(createdProducts).toEqual([{ id: expect.any(String), name: originalName }]);
  const productId = createdProducts[0]!.id;
  expect(await snapshotOnHand(fixture.primaryStoreId, productId)).toBe(7);

  const productSearch = page
    .locator(
      "input[placeholder='Search by SKU or name'], input[placeholder='Search by name, SKU, or barcode']",
    )
    .first();
  await productSearch.fill(sku);
  const productRow = page.getByRole("row").filter({ hasText: originalName });
  await expect(productRow).toHaveCount(1);
  await productRow.getByRole("link", { name: "Edit" }).click();
  await assertPathname(page, `/products/${productId}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(originalName);

  await page.getByLabel("Name").fill(updatedName);
  await rapidClick(page.getByRole("button", { name: "Products save" }).first());
  await assertPathname(page, "/products");
  await assertSingleMutation(mutationAudit, "products.update");
  await assertNoBlockingUi(page);

  const updatedProduct = await prisma.product.findUnique({
    where: { id: productId },
    select: { name: true, sku: true },
  });
  expect(updatedProduct).toEqual({ name: updatedName, sku });

  const reload = await page.reload({ waitUntil: "domcontentloaded" });
  expect(reload).not.toBeNull();
  expect(reload!.status()).toBeLessThan(500);
  await assertPathname(page, "/products");
  await page
    .locator(
      "input[placeholder='Search by SKU or name'], input[placeholder='Search by name, SKU, or barcode']",
    )
    .first()
    .fill(sku);
  const updatedRow = page.getByRole("row").filter({ hasText: updatedName });
  await expect(updatedRow).toHaveCount(1);
  await updatedRow.getByRole("link", { name: "Edit" }).click();
  await assertPathname(page, `/products/${productId}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(updatedName);
  await page.goBack({ waitUntil: "domcontentloaded" });
  await assertPathname(page, "/products");
  assertCleanMutationAudit(mutationAudit);
});

test("@inventory-mutations adjustment Apply de-duplicates and reconciles stock", async ({
  page,
  mutationAudit,
}) => {
  const startedAt = new Date(Date.now() - 1_000);
  await gotoDirect(page, "/dashboard");
  await gotoDirect(page, "/inventory?action=adjust");
  await assertPathname(page, "/inventory");
  const dialog = page.getByRole("dialog", { name: "Stock adjustment" });
  await expect(dialog).toBeVisible();

  const productSearch = dialog.locator("input").first();
  await productSearch.fill(fixture.adjustment.sku);
  const productOption = dialog.getByRole("button").filter({ hasText: fixture.adjustment.name });
  await expect(productOption).toHaveCount(1);
  await productOption.click();
  await dialog.getByLabel("Qty delta").fill("3");
  await dialog.getByLabel("Reason").fill(`${authenticatedE2ESeedPrefix} cycle correction`);
  await rapidClick(dialog.getByRole("button", { name: "Adjust stock" }));

  await assertSingleMutation(mutationAudit, "inventory.adjust");
  await assertNoBlockingUi(page);
  await assertPathname(page, "/inventory");
  expect(await snapshotOnHand(fixture.primaryStoreId, fixture.adjustment.id)).toBe(23);
  const movements = await prisma.stockMovement.findMany({
    where: {
      storeId: fixture.primaryStoreId,
      productId: fixture.adjustment.id,
      type: StockMovementType.ADJUSTMENT,
      createdAt: { gte: startedAt },
    },
    select: { qtyDelta: true },
  });
  expect(movements).toEqual([{ qtyDelta: 3 }]);

  const inventorySearch = page.getByPlaceholder("Search by SKU or name").first();
  await inventorySearch.fill(fixture.adjustment.sku);
  const row = page.getByRole("row").filter({ hasText: fixture.adjustment.name });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("23");
  await page.reload({ waitUntil: "domcontentloaded" });
  await assertPathname(page, "/inventory");
  await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible();
  await page.goBack({ waitUntil: "domcontentloaded" });
  await assertPathname(page, "/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  assertCleanMutationAudit(mutationAudit);
});

test("@inventory-mutations receiving Post settles once and survives reload and Back", async ({
  page,
  mutationAudit,
}) => {
  await gotoDirect(page, "/inventory");
  await gotoDirect(page, "/inventory/receiving");
  await assertPathname(page, "/inventory/receiving");
  await expect(page.getByRole("heading", { level: 1, name: "Stock receiving" })).toBeVisible();

  await expect(
    page.locator(".bazaar-doc-surface").first().getByRole("combobox").first(),
  ).toContainText(primaryStoreName);
  await page.getByPlaceholder("Find a product").fill(fixture.receiving.name);
  const result = page
    .locator(".bazaar-doc-search-row button")
    .filter({ hasText: fixture.receiving.name });
  await expect(result).toHaveCount(1);
  await result.click();
  const line = page.locator("[data-receiving-line-row]");
  await expect(line).toHaveCount(1);
  await line.locator("[data-receiving-input='quantity']").fill("5");
  await line.locator("[data-receiving-input='unitCost']").fill("60");
  await rapidClick(page.getByRole("button", { name: "Post receiving" }).first());

  await assertSingleMutation(mutationAudit, "inventory.postStockReceiving");
  const { currentPath, referenceId } = movementReferenceFromPage(page, "STOCK_RECEIVING");
  await assertMovementDetail(page, fixture.receiving.name, [
    { storeName: primaryStoreName, quantity: "5" },
  ]);
  await assertNoBlockingUi(page);
  expect(await snapshotOnHand(fixture.primaryStoreId, fixture.receiving.id)).toBe(25);
  const movements = await prisma.stockMovement.findMany({
    where: { referenceType: "STOCK_RECEIVING", referenceId },
    select: { storeId: true, productId: true, type: true, qtyDelta: true },
  });
  expect(movements).toEqual([
    {
      storeId: fixture.primaryStoreId,
      productId: fixture.receiving.id,
      type: StockMovementType.RECEIVE,
      qtyDelta: 5,
    },
  ]);
  await assertReloadAndMovementBack(page, currentPath, fixture.receiving.name, [
    { storeName: primaryStoreName, quantity: "5" },
  ]);
  assertCleanMutationAudit(mutationAudit);
});

test("@inventory-mutations transfer Post creates one balanced document and remains coherent", async ({
  page,
  mutationAudit,
}) => {
  await gotoDirect(page, "/inventory");
  await gotoDirect(
    page,
    `/inventory/transfers?fromStoreId=${fixture.primaryStoreId}&toStoreId=${fixture.secondaryStoreId}&productId=${fixture.transfer.id}`,
  );
  await assertPathname(page, "/inventory/transfers");
  await expect(page.getByRole("heading", { level: 1, name: "Transfer stock" })).toBeVisible();
  const line = page.locator("[data-transfer-line-row]");
  await expect(line).toHaveCount(1);
  await line.locator("[data-transfer-input='quantity']").fill("4");
  await rapidClick(page.getByRole("button", { name: "Post transfer" }).first());

  await assertSingleMutation(mutationAudit, "inventory.transfer");
  const { currentPath, referenceId } = movementReferenceFromPage(page, "TRANSFER");
  const expectedRows = [
    { storeName: primaryStoreName, quantity: "-4" },
    { storeName: secondaryStoreName, quantity: "4" },
  ];
  await assertMovementDetail(page, fixture.transfer.name, expectedRows);
  await assertNoBlockingUi(page);
  expect(await snapshotOnHand(fixture.primaryStoreId, fixture.transfer.id)).toBe(16);
  expect(await snapshotOnHand(fixture.secondaryStoreId, fixture.transfer.id)).toBe(14);
  const movements = await prisma.stockMovement.findMany({
    where: { referenceType: "TRANSFER", referenceId },
    orderBy: { type: "asc" },
    select: { storeId: true, productId: true, type: true, qtyDelta: true },
  });
  expect(movements).toEqual(
    expect.arrayContaining([
      {
        storeId: fixture.primaryStoreId,
        productId: fixture.transfer.id,
        type: StockMovementType.TRANSFER_OUT,
        qtyDelta: -4,
      },
      {
        storeId: fixture.secondaryStoreId,
        productId: fixture.transfer.id,
        type: StockMovementType.TRANSFER_IN,
        qtyDelta: 4,
      },
    ]),
  );
  expect(movements).toHaveLength(2);
  await assertReloadAndMovementBack(page, currentPath, fixture.transfer.name, expectedRows);
  assertCleanMutationAudit(mutationAudit);
});

test("@inventory-mutations write-off Post settles once and reconciles document stock", async ({
  page,
  mutationAudit,
}) => {
  await gotoDirect(page, "/inventory");
  await gotoDirect(
    page,
    `/inventory/write-offs?storeId=${fixture.primaryStoreId}&productId=${fixture.writeOff.id}`,
  );
  await assertPathname(page, "/inventory/write-offs");
  await expect(page.getByRole("heading", { level: 1, name: "Stock write-off" })).toBeVisible();
  const line = page.locator("[data-write-off-line-row]");
  await expect(line).toHaveCount(1);
  await page.locator(".bazaar-doc-surface").first().getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: "Брак" }).click();
  await line.locator("[data-write-off-input='quantity']").fill("2");
  await rapidClick(page.getByRole("button", { name: "Post write-off" }).first());

  await assertSingleMutation(mutationAudit, "inventory.postStockWriteOff");
  const { currentPath, referenceId } = movementReferenceFromPage(page, "WRITE_OFF");
  await assertMovementDetail(page, fixture.writeOff.name, [
    { storeName: primaryStoreName, quantity: "-2" },
  ]);
  await assertNoBlockingUi(page);
  expect(await snapshotOnHand(fixture.primaryStoreId, fixture.writeOff.id)).toBe(18);
  const movements = await prisma.stockMovement.findMany({
    where: { referenceType: "WRITE_OFF", referenceId },
    select: { storeId: true, productId: true, type: true, qtyDelta: true },
  });
  expect(movements).toEqual([
    {
      storeId: fixture.primaryStoreId,
      productId: fixture.writeOff.id,
      type: StockMovementType.WRITE_OFF,
      qtyDelta: -2,
    },
  ]);
  await assertReloadAndMovementBack(page, currentPath, fixture.writeOff.name, [
    { storeName: primaryStoreName, quantity: "-2" },
  ]);
  assertCleanMutationAudit(mutationAudit);
});

test("@inventory-mutations mobile inventory lookup and adjustment remain reachable", async ({
  page,
  mutationAudit,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoDirect(page, "/inventory");
  await assertPathname(page, "/inventory");
  await assertNoRootOverflow(page);

  const mobileToolbar = page.locator("[data-mobile-inventory-toolbar]");
  await expect(mobileToolbar).toBeVisible();
  const search = mobileToolbar.getByPlaceholder("Search by SKU or name");
  await search.fill(fixture.mobile.sku);
  const productName = page.locator("p:visible").filter({ hasText: fixture.mobile.name });
  await expect(productName).toHaveCount(1);
  const productCard = productName.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' bg-card ')][1]",
  );
  await expect(productCard).toBeVisible();
  await expect(productCard).toContainText("20");

  const moreActions = productCard.getByRole("button", { name: "More actions" });
  await moreActions.scrollIntoViewIfNeeded();
  await expect(moreActions).toBeInViewport();
  await moreActions.click();
  await page.getByRole("menuitem", { name: "Stock adjustment" }).click();

  const dialog = page.getByRole("dialog", { name: "Stock adjustment" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(fixture.mobile.name);
  await dialog.getByLabel("Qty delta").fill("1");
  await dialog.getByLabel("Reason").fill(`${authenticatedE2ESeedPrefix} mobile correction`);
  const submit = dialog.getByRole("button", { name: "Adjust stock" });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeInViewport();
  await rapidClick(submit);

  await assertSingleMutation(mutationAudit, "inventory.adjust");
  await assertPathname(page, "/inventory");
  await assertNoBlockingUi(page);
  await assertNoRootOverflow(page);
  expect(await snapshotOnHand(fixture.primaryStoreId, fixture.mobile.id)).toBe(21);
  await expect(productCard).toContainText("21");

  const reload = await page.reload({ waitUntil: "domcontentloaded" });
  expect(reload).not.toBeNull();
  expect(reload!.status()).toBeLessThan(500);
  await assertPathname(page, "/inventory");
  await assertNoRootOverflow(page);
  await expect(page.locator("p:visible").filter({ hasText: fixture.mobile.name })).toHaveCount(1);
  expect(await snapshotOnHand(fixture.primaryStoreId, fixture.mobile.id)).toBe(21);
  assertCleanMutationAudit(mutationAudit);
});

test("@inventory-mutations stock-count modal Cancel/Save and Apply settle once", async ({
  page,
  mutationAudit,
}) => {
  const startedAt = new Date(Date.now() - 1_000);
  await gotoDirect(page, "/inventory/counts");
  await gotoDirect(page, `/inventory/counts/${fixture.stockCount.countId}`);
  await assertPathname(page, `/inventory/counts/${fixture.stockCount.countId}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(fixture.stockCount.code);

  const editButton = page.getByRole("button", { name: "Edit counted" }).first();
  await editButton.click();
  const editDialog = page.getByRole("dialog", { name: "Edit counted" });
  await expect(editDialog).toBeVisible();
  await expect
    .poll(() => editDialog.evaluate((dialog) => dialog.contains(document.activeElement)))
    .toBe(true);
  await editDialog.getByLabel("Counted").fill("29");
  await editDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(editDialog).toHaveCount(0);
  await expect(editButton).toBeFocused();
  expect(mutationRequestCount(mutationAudit, "stockCounts.setLineCountedQty")).toBe(0);
  const cancelledLine = await prisma.stockCountLine.findUnique({
    where: { id: fixture.stockCount.countLineId },
    select: { countedQty: true, deltaQty: true },
  });
  expect(cancelledLine).toEqual({ countedQty: 20, deltaQty: 0 });

  await editButton.click();
  const saveDialog = page.getByRole("dialog", { name: "Edit counted" });
  await saveDialog.getByLabel("Counted").fill(String(fixture.stockCount.countedQty));
  await rapidClick(saveDialog.getByRole("button", { name: "Save counted" }));
  await assertSingleMutation(mutationAudit, "stockCounts.setLineCountedQty");
  await expect(saveDialog).toHaveCount(0);
  await expect(page.getByText("24", { exact: true }).first()).toBeVisible();

  await rapidClick(page.getByRole("button", { name: "Apply" }));
  const confirmDialog = page.getByRole("dialog", { name: "Confirm" });
  await expect(confirmDialog).toBeVisible();
  await rapidClick(confirmDialog.getByRole("button", { name: "Confirm" }));
  await assertSingleMutation(mutationAudit, "stockCounts.applyCount");
  await expect(page.getByText("Status applied", { exact: true })).toBeVisible();
  await assertNoBlockingUi(page);

  const [count, line, movements] = await Promise.all([
    prisma.stockCount.findUnique({
      where: { id: fixture.stockCount.countId },
      select: { status: true, appliedAt: true, appliedById: true },
    }),
    prisma.stockCountLine.findUnique({
      where: { id: fixture.stockCount.countLineId },
      select: { expectedOnHand: true, countedQty: true, deltaQty: true },
    }),
    prisma.stockMovement.findMany({
      where: {
        referenceType: "STOCK_COUNT",
        referenceId: fixture.stockCount.countId,
        createdAt: { gte: startedAt },
      },
      select: { productId: true, storeId: true, type: true, qtyDelta: true },
    }),
  ]);
  expect(count).toEqual({
    status: StockCountStatus.APPLIED,
    appliedAt: expect.any(Date),
    appliedById: fixture.adminUserId,
  });
  expect(line).toEqual({ expectedOnHand: 20, countedQty: 24, deltaQty: 4 });
  expect(movements).toEqual([
    {
      productId: fixture.stockCount.id,
      storeId: fixture.primaryStoreId,
      type: StockMovementType.ADJUSTMENT,
      qtyDelta: 4,
    },
  ]);
  expect(await snapshotOnHand(fixture.primaryStoreId, fixture.stockCount.id)).toBe(24);

  await page.reload({ waitUntil: "domcontentloaded" });
  await assertPathname(page, `/inventory/counts/${fixture.stockCount.countId}`);
  await expect(page.getByText("Status applied", { exact: true })).toBeVisible();
  await page.goBack({ waitUntil: "domcontentloaded" });
  await assertPathname(page, "/inventory/counts");
  await expect(page.getByRole("heading", { level: 1, name: "Stock counts" })).toBeVisible();
  assertCleanMutationAudit(mutationAudit);
});
