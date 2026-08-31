import { PrismaClient } from "@prisma/client";
import type { Page, TestInfo } from "@playwright/test";

import { assertAuthenticatedE2EDatabaseUrl, authenticatedE2EIds } from "./contract";
import { authenticatedMasterDataProcurementFixture as procurementFixture } from "./master-data-procurement-contract";
import {
  assertCleanPageAudit,
  assertNoRootOverflow,
  assertVisibleTerminalHeading,
  attachAuditOnFailure,
  expect,
  test,
  type AuthenticatedPageAudit,
} from "./test-fixtures";

const datasourceUrl = assertAuthenticatedE2EDatabaseUrl(process.env.E2E_AUTH_DATABASE_URL);
const prisma = new PrismaClient({ datasourceUrl });
const primaryOrganizationId = authenticatedE2EIds.primaryOrganization;
const primaryStoreId = authenticatedE2EIds.primaryStore;

const gotoStable = async (page: Page, path: string) => {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `${path} must return a document`).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);
  await assertVisibleTerminalHeading(page);
  await assertNoRootOverflow(page);
};

const respondToDiscardConfirmation = async (
  page: Page,
  action: () => Promise<unknown>,
  response: "accept" | "dismiss",
) => {
  const dialogPromise = page.waitForEvent("dialog");
  const actionPromise = action();
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("confirm");
  expect(dialog.message()).toBe("Discard your unsaved changes?");
  if (response === "accept") {
    await dialog.accept();
  } else {
    await dialog.dismiss();
  }
  await actionPromise;
};

const expectNoMutation = (audit: AuthenticatedPageAudit) => {
  expect(audit.blockedSideEffects, "form validation must not attempt a mutation").toEqual([]);
  assertCleanPageAudit(audit);
};

test.afterEach(async ({ pageAudit }, testInfo: TestInfo) => {
  await attachAuditOnFailure(testInfo, pageAudit);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("BZR-REQ-0049/0052/0053/0056 customer boundaries and dirty-cancel protection never mutate", async ({
  page,
  pageAudit,
}) => {
  const before = await prisma.customer.count({ where: { organizationId: primaryOrganizationId } });
  await gotoStable(page, `/customers?storeId=${encodeURIComponent(primaryStoreId)}`);

  const addCustomer = page.getByRole("button", { name: "Add Customer", exact: true });
  await addCustomer.click();
  const dialog = page.getByRole("dialog", { name: "Add customer" });
  const name = dialog.getByRole("textbox", { name: "Name", exact: true });
  const email = dialog.getByRole("textbox", { name: "Email", exact: true });
  const phone = dialog.getByRole("textbox", { name: "Phone", exact: true });
  const address = dialog.getByRole("textbox", { name: "Address", exact: true });
  const create = dialog.getByRole("button", { name: "Create customer", exact: true });

  await expect(create).toBeDisabled();
  await expect(name).toHaveAttribute("maxlength", "180");
  await expect(email).toHaveAttribute("maxlength", "254");
  await expect(phone).toHaveAttribute("maxlength", "64");
  await expect(address).toHaveAttribute("maxlength", "500");

  await name.fill("  Кыргыз кардары Өмүрбек  ");
  await email.fill("missing-domain@");
  await expect(dialog.getByText("Customer email is invalid.", { exact: true })).toBeVisible();
  await expect(create).toBeDisabled();

  await email.fill("");
  await phone.fill("+996 555");
  await expect(
    dialog.getByText("Enter a complete international phone number, including the + country code.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(create).toBeDisabled();

  await phone.fill("+996 555 123 456");
  await address.fill("  Бишкек, Чүй 1  ");
  await expect(create).toBeEnabled();

  await respondToDiscardConfirmation(
    page,
    () => dialog.getByRole("button", { name: "Cancel", exact: true }).click(),
    "dismiss",
  );
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue("  Кыргыз кардары Өмүрбек  ");

  await respondToDiscardConfirmation(
    page,
    () => dialog.getByRole("button", { name: "Cancel", exact: true }).click(),
    "accept",
  );
  await expect(dialog).toBeHidden();
  await expect(addCustomer).toBeEnabled();
  expect(await prisma.customer.count({ where: { organizationId: primaryOrganizationId } })).toBe(
    before,
  );
  expectNoMutation(pageAudit);
});

test("BZR-REQ-0049/0052/0053/0056 supplier validation is explicit and dirty close is reversible", async ({
  page,
  pageAudit,
}) => {
  const before = await prisma.supplier.count({ where: { organizationId: primaryOrganizationId } });
  await gotoStable(page, "/suppliers");
  await page.getByRole("button", { name: "Add supplier", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New supplier" });
  const name = dialog.getByRole("textbox", { name: "Name", exact: true });
  const email = dialog.getByRole("textbox", { name: "Email", exact: true });
  const phone = dialog.getByRole("textbox", { name: "Phone", exact: true });
  const notes = dialog.getByRole("textbox", { name: "Notes", exact: true });
  const create = dialog.getByRole("button", { name: "Create supplier", exact: true });

  await create.click();
  await expect(dialog.getByText("Name must contain at least 2 characters.")).toBeVisible();
  await name.fill("А");
  await create.click();
  await expect(dialog.getByText("Name must contain at least 2 characters.")).toBeVisible();

  await name.fill("  Жеткирүүчү Өнөктөш  ");
  await email.fill("invalid@");
  await create.click();
  await expect(dialog.getByText("Invalid email.", { exact: true })).toBeVisible();

  await email.fill("  supplier.form@example.test  ");
  await phone.fill(" +996 555 987 654 ");
  await notes.fill("  Кыргызча жана кириллица коопсуз сакталат  ");
  await expect(name).toHaveAttribute("maxlength", "180");
  await expect(email).toHaveAttribute("maxlength", "254");
  await expect(phone).toHaveAttribute("maxlength", "80");
  await expect(notes).toHaveAttribute("maxlength", "2000");

  await respondToDiscardConfirmation(
    page,
    () => dialog.getByRole("button", { name: "Cancel", exact: true }).click(),
    "dismiss",
  );
  await expect(dialog).toBeVisible();
  await respondToDiscardConfirmation(
    page,
    () => dialog.getByRole("button", { name: "Cancel", exact: true }).click(),
    "accept",
  );
  await expect(dialog).toBeHidden();
  expect(await prisma.supplier.count({ where: { organizationId: primaryOrganizationId } })).toBe(
    before,
  );
  expectNoMutation(pageAudit);
});

test("BZR-REQ-0050/0051/0056/0068 PO line bounds, rounding, and cancel stay side-effect free", async ({
  page,
  pageAudit,
}) => {
  const before = await prisma.purchaseOrder.count({
    where: { organizationId: primaryOrganizationId },
  });
  await gotoStable(page, "/purchase-orders/new");
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Submit order", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Add line", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add line" });
  const addLine = dialog.getByRole("button", { name: "Add line", exact: true });
  await addLine.click();
  await expect(dialog.getByText("Product is required.", { exact: true })).toBeVisible();

  await dialog.getByPlaceholder("Enter product search").fill(procurementFixture.cancelProduct.sku);
  const product = dialog
    .getByRole("button")
    .filter({ hasText: procurementFixture.cancelProduct.name })
    .first();
  await expect(product).toBeVisible();
  await product.click();
  const quantity = dialog.getByRole("spinbutton", { name: "Order qty", exact: true });
  const unitCost = dialog.getByRole("spinbutton", { name: "Unit cost", exact: true });
  await expect(quantity).toHaveAttribute("min", "1");
  await expect(quantity).toHaveAttribute("max", "2147483647");
  await expect(unitCost).toHaveAttribute("min", "0");
  await expect(unitCost).toHaveAttribute("max", "9999999999.99");

  for (const [value, message] of [
    ["0", "Qty positive"],
    ["-1", "Qty positive"],
    ["1.5", "Quantity must be a whole number."],
    ["2147483648", "Quantity is too large."],
  ] as const) {
    await quantity.fill(value);
    await addLine.click();
    await expect(dialog.getByText(message, { exact: true })).toBeVisible();
  }

  await quantity.fill("3");
  await unitCost.fill("-0.01");
  await addLine.click();
  await expect(dialog.getByText("Unit cost non negative", { exact: true })).toBeVisible();
  await unitCost.fill("10000000000");
  await addLine.click();
  await expect(dialog.getByText("Unit cost is too large.", { exact: true })).toBeVisible();

  await unitCost.fill("10.005");
  await addLine.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/30[,.]03/).first()).toBeVisible();

  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  await respondToDiscardConfirmation(page, () => cancel.click(), "dismiss");
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: procurementFixture.cancelProduct.name })
      .getByText(procurementFixture.cancelProduct.name, { exact: true }),
  ).toBeVisible();
  await respondToDiscardConfirmation(page, () => cancel.click(), "accept");
  await expect.poll(() => new URL(page.url()).pathname).toBe("/purchase-orders");
  expect(
    await prisma.purchaseOrder.count({ where: { organizationId: primaryOrganizationId } }),
  ).toBe(before);
  expectNoMutation(pageAudit);
});

test("BZR-REQ-0128/0129 customer read failure is terminal, retryable, and recovers to real data", async ({
  page,
  pageAudit,
}) => {
  const searchValue = "QA-BAZAAR Authenticated Customer";
  await gotoStable(page, `/customers?storeId=${encodeURIComponent(primaryStoreId)}`);
  await expect(page.getByText(searchValue, { exact: true }).first()).toBeVisible();

  let failCustomerReads = true;
  await page.route("**/api/trpc/**", async (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    if (failCustomerReads && pathname.includes("customers.list")) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Deterministic customer read failure" } }),
      });
      return;
    }
    await route.fallback();
  });

  await page.getByLabel("Search", { exact: true }).fill(searchValue);
  const retry = page.getByRole("button", { name: "Try again", exact: true }).first();
  await expect(retry).toBeVisible();
  await expect(
    page.getByText(
      "This store has no customers yet. Add customers manually, import an existing customer base, or create orders to build the database automatically.",
      { exact: true },
    ),
  ).toHaveCount(0);

  failCustomerReads = false;
  await retry.click();
  await expect(page.getByText(searchValue, { exact: true }).first()).toBeVisible();
  await expect(retry).toHaveCount(0);

  const unexpectedConsoleErrors = pageAudit.consoleErrors.filter(
    (message) => !/failed to load resource.*503|503.*failed to load resource/i.test(message),
  );
  expect(pageAudit.consoleErrors.length, "the controlled 503 must be observed").toBeGreaterThan(0);
  assertCleanPageAudit({ ...pageAudit, consoleErrors: unexpectedConsoleErrors });
});
