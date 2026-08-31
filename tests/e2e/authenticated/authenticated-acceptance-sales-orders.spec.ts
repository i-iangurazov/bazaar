import { CustomerOrderStatus, PrismaClient } from "@prisma/client";
import type { Locator, Page } from "@playwright/test";

import { assertAuthenticatedE2EDatabaseUrl, authenticatedE2EIds } from "./contract";
import { authenticatedSalesOrderAcceptanceFixture as fixture } from "./sales-order-acceptance-contract";
import {
  assertCleanSalesOrderAudit,
  attachSalesOrderAuditOnFailure,
  expect,
  salesOrderMutationCount,
  test,
  type SalesOrderMutationAudit,
  type SalesOrderMutationProcedure,
} from "./sales-order-mutation-test-fixtures";

const datasourceUrl = assertAuthenticatedE2EDatabaseUrl(process.env.E2E_AUTH_DATABASE_URL);
const prisma = new PrismaClient({ datasourceUrl });
const pathname = (page: Page) => new URL(page.url()).pathname;

const gotoDirect = async (page: Page, path: string) => {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `${path} must return a document`).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);
};

const expectNoMobileRootOverflow = async (page: Page) => {
  const overflow = await page.evaluate(
    () =>
      Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) -
      document.documentElement.clientWidth,
  );
  expect(overflow, `mobile route ${pathname(page)} must not overflow the root`).toBeLessThanOrEqual(
    1,
  );
};

const mobileOrderItemCard = (page: Page, productName: string) =>
  page
    .getByRole("heading", { level: 3, name: "Order items", exact: true })
    .locator("../..")
    .locator(".md\\:hidden > .border-border")
    .filter({ hasText: productName });

const rapidClick = async (locator: Locator) => {
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled();
  await locator.evaluate((node) => {
    const button = node as HTMLButtonElement;
    button.click();
    button.click();
  });
};

const expectSingleMutation = async (
  audit: SalesOrderMutationAudit,
  procedure: SalesOrderMutationProcedure,
  previousCount = 0,
) => {
  await expect.poll(() => salesOrderMutationCount(audit, procedure)).toBe(previousCount + 1);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(salesOrderMutationCount(audit, procedure)).toBe(previousCount + 1);
};

const confirmLifecycleAction = async (
  page: Page,
  audit: SalesOrderMutationAudit,
  actionName: string,
  procedure: SalesOrderMutationProcedure,
  successMessage: string,
) => {
  const previousCount = salesOrderMutationCount(audit, procedure);
  await page.getByRole("button", { name: actionName, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expectSingleMutation(audit, procedure, previousCount);
  await expect(page.getByText(successMessage, { exact: true })).toBeVisible();
};

test.afterEach(async ({ salesOrderAudit }, testInfo) => {
  await attachSalesOrderAuditOnFailure(testInfo, salesOrderAudit);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("BZR-REQ-0159 / ORDERS-001 mobile order lifecycle creates and completes exactly one valid line-bearing order", async ({
  page,
  salesOrderAudit,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const initialSnapshot = await prisma.inventorySnapshot.findUniqueOrThrow({
    where: {
      storeId_productId_variantKey: {
        storeId: fixture.storeId,
        productId: fixture.productId,
        variantKey: "BASE",
      },
    },
    select: { onHand: true },
  });
  await expect(
    prisma.customerOrder.count({
      where: {
        organizationId: fixture.organizationId,
        customerName: fixture.createdOrder.customerName,
      },
    }),
  ).resolves.toBe(0);

  await gotoDirect(page, `/sales/orders/new?storeId=${encodeURIComponent(fixture.storeId)}`);
  await expect(page.getByRole("heading", { level: 1, name: "New customer order" })).toBeVisible();
  await expectNoMobileRootOverflow(page);
  const createOrder = page.getByRole("button", { name: "Create order", exact: true });
  await expect(createOrder).toBeDisabled();
  await expect(page.getByText("No order items added yet.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(() => pathname(page)).toBe("/sales/orders");
  await page.goBack({ waitUntil: "domcontentloaded" });
  await expect.poll(() => pathname(page)).toBe("/sales/orders/new");
  await expect(createOrder).toBeDisabled();

  await page.getByPlaceholder("Customer name").fill(fixture.createdOrder.customerName);
  await page.getByPlaceholder("client@example.com").fill(fixture.createdOrder.customerEmail);
  await page.getByPlaceholder("Order comment").fill(fixture.createdOrder.notes);
  const productSearch = page.getByRole("combobox", {
    name: "Start typing name or SKU",
    exact: true,
  });
  await productSearch.fill(fixture.productSku);
  const productOption = page.getByRole("button").filter({ hasText: fixture.productName }).first();
  await expect(productOption).toBeVisible();
  await productOption.click();
  const draftLine = page
    .getByRole("button", { name: "Remove item", exact: true })
    .locator("xpath=ancestor::*[contains(@class,'border-border')][1]");
  await expect(draftLine).toHaveCount(1);
  await expect(draftLine.getByText(fixture.productSku, { exact: true })).toBeVisible();

  const lineQuantity = draftLine.getByRole("spinbutton", { name: "Quantity", exact: true });
  await lineQuantity.fill("0");
  await expect(lineQuantity).toHaveValue("0");
  await expect(createOrder).toBeEnabled();
  await createOrder.click();
  await expect(
    page.getByText("Quantity must be greater than zero.", { exact: true }),
  ).toBeVisible();
  await expect.poll(() => pathname(page)).toBe("/sales/orders/new");
  expect(salesOrderMutationCount(salesOrderAudit, "salesOrders.createDraft")).toBe(0);
  await expect(
    prisma.customerOrder.count({
      where: {
        organizationId: fixture.organizationId,
        customerName: fixture.createdOrder.customerName,
      },
    }),
  ).resolves.toBe(0);

  await lineQuantity.fill(String(fixture.createdOrder.quantity));
  await rapidClick(createOrder);
  await expectSingleMutation(salesOrderAudit, "salesOrders.createDraft");
  await expect.poll(() => pathname(page)).toMatch(/^\/sales\/orders\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Customer order" })).toBeVisible();
  await expectNoMobileRootOverflow(page);

  const orders = await prisma.customerOrder.findMany({
    where: {
      organizationId: fixture.organizationId,
      customerName: fixture.createdOrder.customerName,
    },
    include: { lines: true },
  });
  expect(orders).toHaveLength(1);
  const order = orders[0]!;
  expect(order).toMatchObject({
    status: CustomerOrderStatus.DRAFT,
    customerEmail: fixture.createdOrder.customerEmail,
    notes: fixture.createdOrder.notes,
  });
  expect(Number(order.totalKgs)).toBe(
    fixture.createdOrder.quantity * fixture.createdOrder.unitPriceKgs,
  );
  expect(order.lines).toHaveLength(1);
  expect(order.lines[0]).toMatchObject({
    productId: fixture.productId,
    variantKey: "BASE",
    qty: fixture.createdOrder.quantity,
  });

  const detailPath = pathname(page);
  const reloadResponse = await page.reload({ waitUntil: "domcontentloaded" });
  expect(reloadResponse?.ok()).toBe(true);
  await expect.poll(() => pathname(page)).toBe(detailPath);
  const persistedProductCard = mobileOrderItemCard(page, fixture.productName);
  await expect(persistedProductCard).toHaveCount(1);
  await expect(persistedProductCard).toBeVisible();
  await expect(persistedProductCard.getByText(fixture.productName, { exact: true })).toBeVisible();

  await confirmLifecycleAction(
    page,
    salesOrderAudit,
    "Confirm",
    "salesOrders.confirm",
    "Order confirmed.",
  );
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await confirmLifecycleAction(
    page,
    salesOrderAudit,
    "Ready for pickup",
    "salesOrders.markReady",
    "Order marked as ready.",
  );
  await expect(page.getByText("Ready for pickup", { exact: true }).first()).toBeVisible();
  await confirmLifecycleAction(
    page,
    salesOrderAudit,
    "Complete",
    "salesOrders.complete",
    "Order completed and stock written off.",
  );
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await expectNoMobileRootOverflow(page);

  const completed = await prisma.customerOrder.findUniqueOrThrow({
    where: { id: order.id },
    include: { lines: true },
  });
  expect(completed.status).toBe(CustomerOrderStatus.COMPLETED);
  expect(completed.completedAt).toBeInstanceOf(Date);
  expect(completed.lines).toHaveLength(1);
  const completedSnapshot = await prisma.inventorySnapshot.findUniqueOrThrow({
    where: {
      storeId_productId_variantKey: {
        storeId: fixture.storeId,
        productId: fixture.productId,
        variantKey: "BASE",
      },
    },
    select: { onHand: true },
  });
  expect(completedSnapshot.onHand).toBe(initialSnapshot.onHand - fixture.createdOrder.quantity);
  const movements = await prisma.stockMovement.findMany({
    where: { referenceId: order.id, productId: fixture.productId, storeId: fixture.storeId },
  });
  expect(movements).toHaveLength(1);
  expect(movements[0]?.qtyDelta).toBe(-fixture.createdOrder.quantity);

  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect.poll(() => pathname(page)).toBe("/sales/orders");
  await page.goBack({ waitUntil: "domcontentloaded" });
  await expect.poll(() => pathname(page)).toBe(detailPath);
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  assertCleanSalesOrderAudit(salesOrderAudit);
});

test("BZR-REQ-0072/0159 mobile sales-order add, remove, and re-total math is exact and durable", async ({
  page,
  salesOrderAudit,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const editable = fixture.editableOrder;
  const initialTotal = editable.initialQuantity * fixture.createdOrder.unitPriceKgs;
  const addedLineTotal = editable.addedQuantity * fixture.additionalProduct.unitPriceKgs;
  const expandedTotal = initialTotal + addedLineTotal;
  const foreignBefore = await prisma.customerOrder.findUniqueOrThrow({
    where: { id: authenticatedE2EIds.secondTenantOrder },
    select: { status: true, subtotalKgs: true, totalKgs: true, updatedAt: true },
  });
  const auditCountBefore = await prisma.auditLog.count({
    where: {
      organizationId: fixture.organizationId,
      entity: "CustomerOrder",
      entityId: editable.id,
    },
  });

  await gotoDirect(page, `/sales/orders/${editable.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Customer order" })).toBeVisible();
  await expect(page.getByText(editable.number, { exact: true })).toBeVisible();
  await expectNoMobileRootOverflow(page);
  let order = await prisma.customerOrder.findUniqueOrThrow({
    where: { id: editable.id },
    include: { lines: { orderBy: { id: "asc" } } },
  });
  expect(order).toMatchObject({ status: CustomerOrderStatus.DRAFT });
  expect(Number(order.subtotalKgs)).toBe(initialTotal);
  expect(Number(order.totalKgs)).toBe(initialTotal);
  expect(order.lines).toHaveLength(1);

  const addCount = salesOrderMutationCount(salesOrderAudit, "salesOrders.addLine");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "New item" });
  await expect(dialog).toBeVisible();
  const productSearch = dialog.getByRole("combobox", {
    name: "Start typing name or SKU",
    exact: true,
  });
  await productSearch.fill(fixture.additionalProduct.sku);
  const option = dialog
    .getByRole("button")
    .filter({ hasText: fixture.additionalProduct.name })
    .first();
  await expect(option).toBeVisible();
  await option.click();
  await dialog.getByRole("spinbutton").fill(String(editable.addedQuantity));
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expectSingleMutation(salesOrderAudit, "salesOrders.addLine", addCount);
  await expect(page.getByText("Item added.", { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();

  order = await prisma.customerOrder.findUniqueOrThrow({
    where: { id: editable.id },
    include: { lines: { orderBy: { id: "asc" } } },
  });
  expect(Number(order.subtotalKgs)).toBe(expandedTotal);
  expect(Number(order.totalKgs)).toBe(expandedTotal);
  expect(order.lines).toHaveLength(2);
  const addedLine = order.lines.find((line) => line.productId === fixture.additionalProduct.id);
  expect(addedLine).toBeDefined();
  expect(addedLine?.qty).toBe(editable.addedQuantity);
  expect(Number(addedLine?.unitPriceKgs)).toBe(fixture.additionalProduct.unitPriceKgs);
  expect(Number(addedLine?.lineTotalKgs)).toBe(addedLineTotal);
  const addedCard = mobileOrderItemCard(page, fixture.additionalProduct.name);
  await expect(addedCard).toHaveCount(1);
  await expect(addedCard).toBeVisible();
  await expect(addedCard.getByText(String(editable.addedQuantity), { exact: true })).toBeVisible();
  await expectNoMobileRootOverflow(page);

  const removeCount = salesOrderMutationCount(salesOrderAudit, "salesOrders.removeLine");
  await addedCard.getByRole("button", { name: "Remove item", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Confirm" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Remove item from customer order?", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expectSingleMutation(salesOrderAudit, "salesOrders.removeLine", removeCount);
  await expect(page.getByText("Item removed.", { exact: true })).toBeVisible();
  await expect(page.getByText(fixture.additionalProduct.name, { exact: true })).toHaveCount(0);

  order = await prisma.customerOrder.findUniqueOrThrow({
    where: { id: editable.id },
    include: { lines: true },
  });
  expect(Number(order.subtotalKgs)).toBe(initialTotal);
  expect(Number(order.totalKgs)).toBe(initialTotal);
  expect(order.lines).toHaveLength(1);
  expect(order.lines[0]).toMatchObject({
    id: editable.lineId,
    productId: fixture.productId,
    qty: editable.initialQuantity,
  });

  const auditActions = await prisma.auditLog.findMany({
    where: {
      organizationId: fixture.organizationId,
      entity: "CustomerOrder",
      entityId: editable.id,
    },
    orderBy: { createdAt: "asc" },
    select: { action: true },
  });
  expect(auditActions.slice(auditCountBefore).map((audit) => audit.action)).toEqual([
    "SALES_ORDER_LINE_ADD",
    "SALES_ORDER_LINE_REMOVE",
  ]);
  await expect(
    prisma.customerOrder.findUniqueOrThrow({
      where: { id: authenticatedE2EIds.secondTenantOrder },
      select: { status: true, subtotalKgs: true, totalKgs: true, updatedAt: true },
    }),
  ).resolves.toEqual(foreignBefore);

  const reloadResponse = await page.reload({ waitUntil: "domcontentloaded" });
  expect(reloadResponse?.ok()).toBe(true);
  await expect(page.getByText(editable.number, { exact: true })).toBeVisible();
  await expect(page.getByText(fixture.additionalProduct.name, { exact: true })).toHaveCount(0);
  await expectNoMobileRootOverflow(page);
  assertCleanSalesOrderAudit(salesOrderAudit);
});

test("ORDERS-002 canceled orders expose no mutable tracking, confirmation, or line controls", async ({
  page,
  salesOrderAudit,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const orderId = fixture.canceledOrder.id;
  const before = await Promise.all([
    prisma.customerOrderEmailLog.count({ where: { customerOrderId: orderId } }),
    prisma.auditLog.count({
      where: {
        organizationId: fixture.organizationId,
        entity: "CustomerOrder",
        entityId: orderId,
      },
    }),
  ]);
  expect(before).toEqual([0, 0]);

  const detailPath = `/sales/orders/${orderId}`;
  await gotoDirect(page, detailPath);
  await expect(page.getByRole("heading", { level: 1, name: "Customer order" })).toBeVisible();
  await expect(page.getByText(fixture.canceledOrder.number, { exact: true })).toBeVisible();
  await expect(page.getByText("Canceled", { exact: true })).toBeVisible();

  for (const placeholder of [
    "Customer name",
    "client@example.com",
    "Tracking or shipment number",
    "DHL, FedEx, local courier",
    "Shipped, in transit, delivered",
    "https://...",
  ]) {
    await expect(page.getByPlaceholder(placeholder)).toBeDisabled();
  }
  for (const buttonName of [
    "Save customer details",
    "Send tracking email",
    "Save tracking",
    "Send confirmation email",
  ]) {
    const button = page.getByRole("button", { name: buttonName, exact: true });
    await expect(button).toBeDisabled();
  }
  for (const unavailableAction of [
    "Confirm",
    "Ready for pickup",
    "Complete",
    "Cancel",
    "Add item",
  ]) {
    await expect(page.getByRole("button", { name: unavailableAction, exact: true })).toHaveCount(0);
  }

  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(salesOrderAudit.allowedMutations).toEqual([]);
  await expect(
    prisma.customerOrderEmailLog.count({ where: { customerOrderId: orderId } }),
  ).resolves.toBe(0);
  await expect(
    prisma.auditLog.count({
      where: {
        organizationId: fixture.organizationId,
        entity: "CustomerOrder",
        entityId: orderId,
      },
    }),
  ).resolves.toBe(0);
  await expect(
    prisma.customerOrder.findUniqueOrThrow({ where: { id: orderId } }),
  ).resolves.toMatchObject({
    status: CustomerOrderStatus.CANCELED,
    trackingNumber: null,
    confirmationEmailSentAt: null,
    trackingEmailSentAt: null,
  });

  await expect.poll(() => pathname(page)).toBe(detailPath);
  const reloadResponse = await page.reload({ waitUntil: "domcontentloaded" });
  expect(reloadResponse?.ok()).toBe(true);
  await expect.poll(() => pathname(page)).toBe(detailPath);
  await expect(page.getByText("Canceled", { exact: true })).toBeVisible();
  assertCleanSalesOrderAudit(salesOrderAudit);
});
