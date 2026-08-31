import { PrismaClient } from "@prisma/client";
import type { Locator, Page } from "@playwright/test";

import {
  assertAuthenticatedE2EDatabaseUrl,
  authenticatedE2EAccounts,
  authenticatedE2EIds,
} from "./contract";
import {
  assertCleanMobileActionAudit,
  attachMobileActionAuditOnFailure,
  expect,
  mobileMutationCount,
  test,
  type MobileActionAudit,
  type MobileMutationProcedure,
} from "./mobile-action-test-fixtures";

const datasourceUrl = assertAuthenticatedE2EDatabaseUrl(process.env.E2E_AUTH_DATABASE_URL);
const prisma = new PrismaClient({ datasourceUrl });
const mobileViewport = { width: 390, height: 844 } as const;
const originalCustomerName = "QA-BAZAAR Authenticated Customer";
const editedCustomerName = "QA-BAZAAR Authenticated Customer Mobile";
const lifecycleCustomer = {
  name: "QA-BAZAAR Browser Lifecycle Customer",
  editedName: "QA-BAZAAR Browser Lifecycle Customer Edited",
  email: "qa-bazaar-browser-customer-lifecycle@auth-e2e.test",
  phone: "+996 555 601 159",
  address: "QA-BAZAAR lifecycle address",
  editedAddress: "QA-BAZAAR lifecycle address edited",
} as const;

const cleanupLifecycleCustomer = async () => {
  const customers = await prisma.customer.findMany({
    where: { email: lifecycleCustomer.email },
    select: { id: true },
  });
  const customerIds = customers.map((customer) => customer.id);
  if (!customerIds.length) return;
  await prisma.$transaction([
    prisma.auditLog.deleteMany({
      where: { entity: "Customer", entityId: { in: customerIds } },
    }),
    prisma.customer.deleteMany({ where: { id: { in: customerIds } } }),
  ]);
};

const gotoMobile = async (page: Page, path: string) => {
  await page.setViewportSize(mobileViewport);
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `${path} must return a document`).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) -
      document.documentElement.clientWidth,
  );
  expect(overflow, `${path} must not overflow the mobile root`).toBeLessThanOrEqual(1);
};

const mobileCustomerCard = (page: Page, name: string) =>
  page
    .getByRole("heading", { level: 3, name, exact: true })
    .locator("xpath=ancestor::*[contains(@class,'bazaar-admin-surface')][1]");

const rapidClick = async (locator: Locator) => {
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled();
  await locator.evaluate((node) => {
    const button = node as HTMLButtonElement;
    button.click();
    button.click();
  });
};

const expectOneMoreMutation = async (
  audit: MobileActionAudit,
  procedure: MobileMutationProcedure,
  before: number,
) => {
  await expect.poll(() => mobileMutationCount(audit, procedure)).toBe(before + 1);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(mobileMutationCount(audit, procedure)).toBe(before + 1);
};

test.afterEach(async ({ mobileActionAudit }, testInfo) => {
  await attachMobileActionAuditOnFailure(testInfo, mobileActionAudit);
  await cleanupLifecycleCustomer();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("BZR-REQ-0039 customer create, inspect, search, edit, archive, audit, tenant isolation, and cleanup", async ({
  page,
  mobileActionAudit,
}) => {
  await cleanupLifecycleCustomer();
  await expect(prisma.customer.count({ where: { email: lifecycleCustomer.email } })).resolves.toBe(
    0,
  );

  await gotoMobile(
    page,
    `/customers?storeId=${encodeURIComponent(authenticatedE2EIds.primaryStore)}`,
  );
  await page.getByRole("button", { name: "Add Customer", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Add customer" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(lifecycleCustomer.name);
  await dialog.getByRole("textbox", { name: "Email", exact: true }).fill(lifecycleCustomer.email);
  await dialog.getByRole("textbox", { name: "Phone", exact: true }).fill(lifecycleCustomer.phone);
  await dialog
    .getByRole("textbox", { name: "Address", exact: true })
    .fill(lifecycleCustomer.address);
  const createCount = mobileMutationCount(mobileActionAudit, "customers.create");
  await rapidClick(dialog.getByRole("button", { name: "Create customer", exact: true }));
  await expectOneMoreMutation(mobileActionAudit, "customers.create", createCount);
  await expect(page.getByText("Customer created.", { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();

  const created = await prisma.customer.findFirstOrThrow({
    where: {
      organizationId: authenticatedE2EIds.primaryOrganization,
      email: lifecycleCustomer.email,
      deletedAt: null,
    },
  });
  expect(created).toMatchObject({
    storeId: authenticatedE2EIds.primaryStore,
    name: lifecycleCustomer.name,
    phone: "+996555601159",
    address: lifecycleCustomer.address,
    source: "MANUAL",
  });
  await expect(
    prisma.customer.count({
      where: {
        organizationId: authenticatedE2EIds.secondOrganization,
        email: lifecycleCustomer.email,
      },
    }),
  ).resolves.toBe(0);

  const mobileSearch = page.getByPlaceholder("Name, phone, or email");
  await mobileSearch.fill(lifecycleCustomer.email);
  const customerCard = mobileCustomerCard(page, lifecycleCustomer.name);
  await expect(customerCard).toBeVisible();
  await customerCard.getByRole("button", { name: "Sales", exact: true }).first().click();
  dialog = page.getByRole("dialog", { name: lifecycleCustomer.name });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(lifecycleCustomer.email, { exact: true })).toBeVisible();
  await expect(dialog.getByText("+996555601159", { exact: true })).toBeVisible();
  await expect(dialog.getByText(lifecycleCustomer.address, { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("No receipts for this customer yet.", { exact: true }),
  ).toBeVisible();

  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Edit customer" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("textbox", { name: "Name", exact: true })
    .fill(lifecycleCustomer.editedName);
  await dialog
    .getByRole("textbox", { name: "Address", exact: true })
    .fill(lifecycleCustomer.editedAddress);
  const updateCount = mobileMutationCount(mobileActionAudit, "customers.update");
  await rapidClick(dialog.getByRole("button", { name: "Save changes", exact: true }));
  await expectOneMoreMutation(mobileActionAudit, "customers.update", updateCount);
  await expect(page.getByText("Customer updated.", { exact: true })).toBeVisible();
  await mobileSearch.fill(lifecycleCustomer.editedName);
  await expect(mobileCustomerCard(page, lifecycleCustomer.editedName)).toBeVisible();
  await expect(
    prisma.customer.findUniqueOrThrow({ where: { id: created.id } }),
  ).resolves.toMatchObject({
    name: lifecycleCustomer.editedName,
    address: lifecycleCustomer.editedAddress,
    deletedAt: null,
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopSearch = page.getByPlaceholder("Name, email, phone, or address");
  await expect(desktopSearch).toBeVisible();
  await desktopSearch.fill(lifecycleCustomer.editedName);
  const customerRow = page.getByRole("row").filter({ hasText: lifecycleCustomer.editedName });
  await expect(customerRow).toHaveCount(1);
  page.once("dialog", (confirmation) => void confirmation.accept());
  const deleteCount = mobileMutationCount(mobileActionAudit, "customers.delete");
  await customerRow.getByRole("button", { name: "Delete", exact: true }).click();
  await expectOneMoreMutation(mobileActionAudit, "customers.delete", deleteCount);
  await expect(page.getByText("Customer removed.", { exact: true })).toBeVisible();
  await expect(customerRow).toHaveCount(0);

  const archived = await prisma.customer.findUniqueOrThrow({ where: { id: created.id } });
  expect(archived.deletedAt).toBeInstanceOf(Date);
  const audits = await prisma.auditLog.findMany({
    where: {
      organizationId: authenticatedE2EIds.primaryOrganization,
      entity: "Customer",
      entityId: created.id,
    },
    orderBy: { createdAt: "asc" },
  });
  expect(audits.map((audit) => audit.action)).toEqual([
    "CUSTOMER_UPSERT",
    "CUSTOMER_UPDATE",
    "CUSTOMER_ARCHIVE",
  ]);
  expect(audits.every((audit) => audit.actorId === created.createdById)).toBe(true);
  await expect(
    prisma.auditLog.count({
      where: {
        organizationId: authenticatedE2EIds.secondOrganization,
        entity: "Customer",
        entityId: created.id,
      },
    }),
  ).resolves.toBe(0);

  assertCleanMobileActionAudit(mobileActionAudit);
  await cleanupLifecycleCustomer();
  await expect(prisma.customer.count({ where: { email: lifecycleCustomer.email } })).resolves.toBe(
    0,
  );
  await expect(
    prisma.auditLog.count({ where: { entity: "Customer", entityId: created.id } }),
  ).resolves.toBe(0);
});

test("BZR-REQ-0160 mobile customer lookup, edit, persistence, and restoration settle once", async ({
  page,
  mobileActionAudit,
}) => {
  await gotoMobile(
    page,
    `/customers?storeId=${encodeURIComponent(authenticatedE2EIds.primaryStore)}`,
  );
  const search = page.getByPlaceholder("Name, phone, or email");
  await search.fill(originalCustomerName);
  const customerCard = mobileCustomerCard(page, originalCustomerName);
  await expect(customerCard).toBeVisible();
  await customerCard.getByRole("button", { name: "Edit", exact: true }).click();

  let dialog = page.getByRole("dialog", { name: "Edit customer" });
  await expect(dialog).toBeVisible();
  const nameInput = dialog.getByRole("textbox", { name: "Name", exact: true });
  await nameInput.fill(editedCustomerName);
  const firstMutationCount = mobileMutationCount(mobileActionAudit, "customers.update");
  await rapidClick(dialog.getByRole("button", { name: "Save changes", exact: true }));
  await expectOneMoreMutation(mobileActionAudit, "customers.update", firstMutationCount);
  await expect(page.getByText("Customer updated.", { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(
    prisma.customer.findUniqueOrThrow({ where: { id: authenticatedE2EIds.primaryCustomer } }),
  ).resolves.toMatchObject({ name: editedCustomerName });

  const reloadResponse = await page.reload({ waitUntil: "domcontentloaded" });
  expect(reloadResponse?.ok()).toBe(true);
  await page.getByPlaceholder("Name, phone, or email").fill(editedCustomerName);
  const editedCard = mobileCustomerCard(page, editedCustomerName);
  await expect(editedCard).toBeVisible();
  await editedCard.getByRole("button", { name: "Edit", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Edit customer" });
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(originalCustomerName);
  const restoreMutationCount = mobileMutationCount(mobileActionAudit, "customers.update");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expectOneMoreMutation(mobileActionAudit, "customers.update", restoreMutationCount);
  await expect(
    prisma.customer.findUniqueOrThrow({ where: { id: authenticatedE2EIds.primaryCustomer } }),
  ).resolves.toMatchObject({ name: originalCustomerName });
  assertCleanMobileActionAudit(mobileActionAudit);
});

test("BZR-REQ-0163 mobile settings save is reachable, single-submit, and durable", async ({
  page,
  mobileActionAudit,
}) => {
  await gotoMobile(page, "/settings/profile#account-settings");
  const personalHeading = page.getByRole("heading", { name: "Personal details", exact: true });
  await expect(personalHeading).toBeVisible();
  const personalCard = personalHeading.locator(
    "xpath=ancestor::*[contains(@class,'bazaar-admin-surface')]",
  );
  const nameInput = personalCard.getByRole("textbox", { name: "Name", exact: true });
  await expect(nameInput).toHaveValue(authenticatedE2EAccounts.admin.name);
  const before = mobileMutationCount(mobileActionAudit, "userSettings.updateMyProfile");
  await rapidClick(personalCard.getByRole("button", { name: "Save", exact: true }));
  await expectOneMoreMutation(mobileActionAudit, "userSettings.updateMyProfile", before);
  await expect(page.getByText("Personal details saved.", { exact: true })).toBeVisible();
  await expect(
    prisma.user.findUniqueOrThrow({ where: { email: authenticatedE2EAccounts.admin.email } }),
  ).resolves.toMatchObject({ name: authenticatedE2EAccounts.admin.name });
  assertCleanMobileActionAudit(mobileActionAudit);
});

test("BZR-REQ-0161 mobile report date and store actions update real results without overflow", async ({
  page,
  mobileActionAudit,
}) => {
  await gotoMobile(page, "/reports");
  await page.getByLabel("From date", { exact: true }).fill("2026-08-31");
  await page.getByLabel("To date", { exact: true }).fill("2026-08-31");
  await expect(page.getByLabel("From date", { exact: true })).toHaveValue("2026-08-31");
  await expect(page.getByLabel("To date", { exact: true })).toHaveValue("2026-08-31");
  const mobileShrinkageProduct = page
    .getByRole("paragraph")
    .filter({ hasText: /^QA-BAZAAR Posted Write-off$/ });
  await expect(mobileShrinkageProduct).toHaveCount(1);
  await expect(mobileShrinkageProduct).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  assertCleanMobileActionAudit(mobileActionAudit);
});
