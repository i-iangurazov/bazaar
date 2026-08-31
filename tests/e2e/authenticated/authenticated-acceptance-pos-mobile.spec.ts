import { PrismaClient } from "@prisma/client";
import type { Locator, Page } from "@playwright/test";

import { assertAuthenticatedE2EDatabaseUrl } from "./contract";
import { authenticatedPosMobileFixture } from "./pos-mobile-contract";
import {
  assertCleanPosMobileAudit,
  attachPosMobileAuditOnFailure,
  expect,
  posMobileMutationCount,
  test,
  type PosMobileAudit,
  type PosMobileMutationProcedure,
} from "./pos-mobile-test-fixtures";

const datasourceUrl = assertAuthenticatedE2EDatabaseUrl(process.env.E2E_AUTH_DATABASE_URL);
const prisma = new PrismaClient({ datasourceUrl });
const mobileViewport = { width: 390, height: 844 } as const;
const tabletViewport = { width: 1024, height: 768 } as const;

const assertNoRootOverflow = async (page: Page) => {
  const overflow = await page.evaluate(
    () =>
      Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) -
      document.documentElement.clientWidth,
  );
  expect(overflow, "root document must not overflow horizontally").toBeLessThanOrEqual(1);
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

const assertOneMutation = async (audit: PosMobileAudit, procedure: PosMobileMutationProcedure) => {
  await expect.poll(() => posMobileMutationCount(audit, procedure)).toBe(1);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(posMobileMutationCount(audit, procedure)).toBe(1);
};

const latestCompletedFixtureSale = () =>
  prisma.customerOrder.findFirst({
    where: {
      organizationId: authenticatedPosMobileFixture.organizationId,
      storeId: authenticatedPosMobileFixture.storeId,
      registerId: authenticatedPosMobileFixture.registerId,
      isPosSale: true,
      status: "COMPLETED",
      lines: { some: { productId: authenticatedPosMobileFixture.product.id } },
    },
    orderBy: { completedAt: "desc" },
    include: {
      lines: true,
      payments: true,
      fiscalReceipts: true,
    },
  });

test.describe.configure({ mode: "serial" });

test.afterEach(async ({ posMobileAudit }, testInfo) => {
  await attachPosMobileAuditOnFailure(testInfo, posMobileAudit);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("BZR-REQ-0037/0075/0076/0077/0078/0158 mobile cart, customer, discount, split payment and ledger settle once", async ({
  page,
  posMobileAudit,
}) => {
  const fixture = authenticatedPosMobileFixture;
  const startedAt = new Date();
  const selectedCustomer = await prisma.customer.findUniqueOrThrow({
    where: { id: fixture.customer.id },
    select: { name: true, email: true, phone: true, address: true },
  });
  await page.setViewportSize(mobileViewport);
  const response = await page.goto(
    `/pos/sell?registerId=${encodeURIComponent(fixture.registerId)}`,
    { waitUntil: "domcontentloaded" },
  );
  expect(response?.status()).toBeLessThan(500);
  await expect(page.getByRole("heading", { level: 1, name: "Sell" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add products", exact: true })).toBeEnabled();
  await assertNoRootOverflow(page);

  await page.getByRole("button", { name: "Add products", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Catalog" })).toBeVisible();
  const search = page.getByRole("combobox", { name: "Search", exact: true });
  await search.fill(fixture.product.sku);
  const product = page.locator(
    `[data-testid="pos-product-button"][data-product-id="${fixture.product.id}"]`,
  );
  await expect(product).toContainText(fixture.product.name);
  await expect(product).toContainText(fixture.product.sku);
  await product.click();

  const lineDialog = page.getByRole("dialog", { name: fixture.product.name });
  await expect(lineDialog).toBeVisible();
  await expect(lineDialog.getByTestId("pos-line-qty")).toHaveText("1");
  await lineDialog.getByRole("button", { name: "Increase quantity", exact: true }).click();
  await expect(lineDialog.getByTestId("pos-line-qty")).toHaveText(
    String(fixture.product.saleQuantity),
  );
  await lineDialog.getByRole("button", { name: "↵", exact: true }).click();
  await expect(lineDialog).toBeHidden();
  const cartLine = page.getByTestId("pos-cart-line").filter({ hasText: fixture.product.name });
  await expect(cartLine).toBeVisible();
  await expect(cartLine).toContainText(`${fixture.product.saleQuantity} x`);
  await assertOneMutation(posMobileAudit, "pos.sales.updateLine");

  const customerRow = page
    .getByRole("button")
    .filter({ hasText: "Client" })
    .filter({ hasText: "Retail customer" });
  await expect(customerRow).toBeVisible();
  await customerRow.click();
  const customerDialog = page.getByRole("dialog", { name: "Select customer" });
  await expect(customerDialog).toBeVisible();
  await customerDialog
    .getByPlaceholder("Search customer by name or phone")
    .fill(fixture.customer.name);
  const customerResult = customerDialog
    .getByRole("button")
    .filter({ hasText: fixture.customer.name });
  await expect(customerResult).toBeVisible();
  await customerResult.click();
  await expect(customerDialog).toBeHidden();
  await expect(page.getByRole("button").filter({ hasText: fixture.customer.name })).toBeVisible();
  await assertOneMutation(posMobileAudit, "pos.sales.updateCustomer");

  await page.getByRole("button", { name: "Back", exact: true }).first().click();
  let exitDialog = page.getByRole("dialog", { name: "Leave this sale?" });
  await expect(exitDialog).toBeVisible();
  await exitDialog.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(exitDialog).toBeHidden();
  await expect(cartLine).toBeVisible();

  await page.evaluate(() => window.history.back());
  exitDialog = page.getByRole("dialog", { name: "Leave this sale?" });
  await expect(exitDialog).toBeVisible();
  await exitDialog.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(cartLine).toBeVisible();

  await assertOneMutation(posMobileAudit, "pos.sales.createDraft");
  await assertOneMutation(posMobileAudit, "pos.sales.addLine");
  const draft = await prisma.customerOrder.findFirstOrThrow({
    where: {
      organizationId: fixture.organizationId,
      registerId: fixture.registerId,
      createdById: fixture.adminUserId,
      isPosSale: true,
      status: "DRAFT",
      createdAt: { gte: startedAt },
      lines: { some: { productId: fixture.product.id } },
    },
    include: { lines: true },
  });
  expect(draft.lines).toHaveLength(1);
  expect(draft.lines[0]).toMatchObject({
    productId: fixture.product.id,
    qty: fixture.product.saleQuantity,
  });
  expect(draft).toMatchObject({
    customerName: selectedCustomer.name,
    customerEmail: selectedCustomer.email,
    customerPhone: selectedCustomer.phone,
    customerAddress: selectedCustomer.address,
  });

  await page.getByRole("button", { name: "Go to payment", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Payment summary", exact: true })).toBeVisible();
  await expect(page.getByTestId("pos-cart-total")).toContainText("274.50");
  await page.getByRole("button", { name: /Add discount/ }).click();
  const discountSheet = page.getByTestId("pos-mobile-discount-sheet");
  await expect(discountSheet).toBeVisible();
  await discountSheet.getByTestId("pos-mobile-discount-input").fill(String(fixture.discountKgs));
  await discountSheet.getByTestId("pos-mobile-discount-apply").click();
  await expect(discountSheet).toBeHidden();
  await assertOneMutation(posMobileAudit, "pos.sales.updateDiscount");
  const expectedTotalKgs =
    fixture.product.basePriceKgs * fixture.product.saleQuantity - fixture.discountKgs;
  await expect(page.getByTestId("pos-cart-total")).toContainText(expectedTotalKgs.toFixed(2));

  await page.getByRole("button", { name: "Add payment", exact: true }).click();
  const paymentAmounts = page.getByPlaceholder("Payment amount");
  await expect(paymentAmounts).toHaveCount(2);
  await paymentAmounts.nth(0).fill(String(fixture.payments.cashKgs));
  await paymentAmounts.nth(1).fill(String(fixture.payments.cardKgs));
  await expect(
    page.getByText("Payment total:", { exact: false }).filter({
      hasText: expectedTotalKgs.toFixed(2),
    }),
  ).toBeVisible();
  const complete = page.getByRole("button", { name: "Complete sale", exact: true });
  await rapidClick(complete);
  await expect(page.getByRole("heading", { name: "Sale completed", exact: true })).toBeVisible();
  await assertOneMutation(posMobileAudit, "pos.sales.complete");

  const sale = await expect.poll(latestCompletedFixtureSale).not.toBeNull();
  void sale;
  const completed = await latestCompletedFixtureSale();
  expect(completed).not.toBeNull();
  expect(completed).toMatchObject({
    id: draft.id,
    organizationId: fixture.organizationId,
    storeId: fixture.storeId,
    registerId: fixture.registerId,
    shiftId: fixture.shiftId,
    status: "COMPLETED",
    isPosSale: true,
  });
  expect(Number(completed!.subtotalKgs)).toBe(
    fixture.product.basePriceKgs * fixture.product.saleQuantity,
  );
  expect(Number(completed!.discountKgs)).toBe(fixture.discountKgs);
  expect(Number(completed!.totalKgs)).toBe(expectedTotalKgs);
  expect(completed).toMatchObject({
    customerName: selectedCustomer.name,
    customerEmail: selectedCustomer.email,
    customerPhone: selectedCustomer.phone,
    customerAddress: selectedCustomer.address,
  });
  expect(completed!.lines).toHaveLength(1);
  expect(completed!.lines[0]).toMatchObject({
    productId: fixture.product.id,
    qty: fixture.product.saleQuantity,
  });
  expect(Number(completed!.lines[0]!.unitPriceKgs)).toBe(fixture.product.basePriceKgs);
  expect(Number(completed!.lines[0]!.lineTotalKgs)).toBe(
    fixture.product.basePriceKgs * fixture.product.saleQuantity,
  );
  expect(completed!.payments).toHaveLength(2);
  expect(
    completed!.payments
      .map((payment) => ({
        method: payment.method,
        amountKgs: Number(payment.amountKgs),
        storeId: payment.storeId,
        shiftId: payment.shiftId,
        isRefund: payment.isRefund,
      }))
      .sort((left, right) => left.method.localeCompare(right.method)),
  ).toEqual(
    [
      {
        method: "CASH",
        amountKgs: fixture.payments.cashKgs,
        storeId: fixture.storeId,
        shiftId: fixture.shiftId,
        isRefund: false,
      },
      {
        method: "CARD",
        amountKgs: fixture.payments.cardKgs,
        storeId: fixture.storeId,
        shiftId: fixture.shiftId,
        isRefund: false,
      },
    ].sort((left, right) => left.method.localeCompare(right.method)),
  );
  expect(completed!.fiscalReceipts).toHaveLength(0);

  const [snapshot, movements] = await Promise.all([
    prisma.inventorySnapshot.findUniqueOrThrow({
      where: {
        storeId_productId_variantKey: {
          storeId: fixture.storeId,
          productId: fixture.product.id,
          variantKey: fixture.variantKey,
        },
      },
    }),
    prisma.stockMovement.findMany({
      where: {
        storeId: fixture.storeId,
        productId: fixture.product.id,
        referenceType: "CustomerOrder",
        referenceId: draft.id,
        type: "SALE",
      },
    }),
  ]);
  expect(snapshot.onHand).toBe(fixture.product.baselineOnHand - fixture.product.saleQuantity);
  expect(movements).toHaveLength(1);
  expect(movements[0]).toMatchObject({
    qtyDelta: -fixture.product.saleQuantity,
    referenceType: "CustomerOrder",
    referenceId: draft.id,
  });
  await assertNoRootOverflow(page);
  assertCleanPosMobileAudit(posMobileAudit);
});

test("BZR-REQ-0171 / LAYOUT-002 populated receipt routes keep 1024px overflow internal and actions reachable", async ({
  page,
  posMobileAudit,
}) => {
  const fixture = authenticatedPosMobileFixture;
  const completed = await latestCompletedFixtureSale();
  expect(completed, "the serial mobile checkout must create a completed receipt").not.toBeNull();
  await page.setViewportSize(tabletViewport);

  for (const path of ["/pos/receipts", "/reports/receipts"]) {
    const params = new URLSearchParams({
      storeId: fixture.storeId,
      status: "COMPLETED",
    });
    const response = await page.goto(`${path}?${params.toString()}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByRole("heading", { level: 1, name: "Receipts" })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: completed!.number });
    await expect(row).toBeVisible();
    const expectedTotalKgs =
      fixture.product.basePriceKgs * fixture.product.saleQuantity - fixture.discountKgs;
    await expect(row).toContainText(expectedTotalKgs.toFixed(2));
    await assertNoRootOverflow(page);

    const scrollContainer = page.locator(".bazaar-admin-table-scroll").filter({
      has: page.getByRole("table"),
    });
    const containment = await scrollContainer.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        overflowX: style.overflowX,
      };
    });
    expect(["auto", "scroll"]).toContain(containment.overflowX);
    expect(containment.scrollWidth).toBeGreaterThan(containment.clientWidth);
    await scrollContainer.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });

    for (const action of ["Preview", "Print receipt", "Download receipt PDF", "Share receipt"]) {
      const button = row.getByRole("button", { name: action, exact: true });
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
      const box = await button.boundingBox();
      expect(box, `${action} must have a visible tablet bounding box`).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(tabletViewport.width);
    }

    await row.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("dialog", { name: `Receipt ${completed!.number}` });
    await expect(preview).toBeVisible();
    await expect(
      preview.getByRole("table").getByText(fixture.product.name, { exact: true }),
    ).toBeVisible();
    const paymentsSection = preview
      .getByRole("heading", { level: 3, name: "Payments", exact: true })
      .locator("xpath=ancestor::div[contains(@class,'border-b')][1]");
    await expect(paymentsSection).toContainText("Cash");
    await expect(preview).toContainText(expectedTotalKgs.toFixed(2));
    await preview.getByRole("button", { name: "Close", exact: true }).click();
    await expect(preview).toBeHidden();
    await assertNoRootOverflow(page);
  }

  expect(posMobileAudit.allowedMutations).toEqual([]);
  assertCleanPosMobileAudit(posMobileAudit);
});
