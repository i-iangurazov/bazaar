import type { Page } from "@playwright/test";

import { authenticatedE2EIds } from "./contract";
import {
  assertCleanPageAudit,
  assertNoRedirectLoop,
  assertNoRootOverflow,
  assertVisibleTerminalHeading,
  attachAuditOnFailure,
  expect,
  test,
  type AuthenticatedPageAudit,
} from "./test-fixtures";

const transferMovementDocumentKey = `TRANSFER:TRANSFER:${authenticatedE2EIds.transferReference}`;
const transferMovementDocumentSegment = encodeURIComponent(transferMovementDocumentKey);
const transferMovementDetailPath = `/inventory/movements/${transferMovementDocumentSegment}`;
const transferMovementPrintPath = `${transferMovementDetailPath}/print`;
const primaryTransferStoreName = "QA-BAZAAR Primary Store";
const secondaryTransferStoreName = "QA-BAZAAR Secondary Store";

const assertPathname = async (page: Page, pathname: string) => {
  await expect.poll(() => new URL(page.url()).pathname).toBe(pathname);
};

const gotoDirect = async (page: Page, path: string) => {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `direct navigation to ${path} must produce a document response`).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);
};

const assertStablePage = async (page: Page, audit: AuthenticatedPageAudit) => {
  await assertVisibleTerminalHeading(page);
  await assertNoRootOverflow(page);
  await page.waitForTimeout(500);
  await assertVisibleTerminalHeading(page);
  await assertNoRootOverflow(page);
  assertNoRedirectLoop(audit);
  assertCleanPageAudit(audit);
};

const assertTransferDetailLegs = async (page: Page) => {
  await expect(page.getByRole("heading", { level: 3, name: "Movement lines" })).toBeVisible();
  const table = page.getByRole("table");
  await expect(table).toHaveCount(1);
  await expect(table.locator("tbody tr")).toHaveCount(2);

  const sourceRow = table.getByRole("row").filter({ hasText: primaryTransferStoreName });
  const destinationRow = table.getByRole("row").filter({ hasText: secondaryTransferStoreName });
  await expect(sourceRow).toHaveCount(1);
  await expect(destinationRow).toHaveCount(1);

  const sourceCells = sourceRow.getByRole("cell");
  const destinationCells = destinationRow.getByRole("cell");
  await expect(sourceCells.nth(1)).toHaveText(primaryTransferStoreName);
  await expect(sourceCells.nth(2)).toHaveText("Transfer out");
  await expect(sourceCells.nth(3)).toHaveText("-4");
  await expect(destinationCells.nth(1)).toHaveText(secondaryTransferStoreName);
  await expect(destinationCells.nth(2)).toHaveText("Transfer in");
  await expect(destinationCells.nth(3)).toHaveText("4");
};

const assertTransferPrintLegs = async (page: Page) => {
  const sheet = page.locator(".movement-print-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { level: 1, name: "Store transfer" })).toBeVisible();

  const rows = sheet.locator(".movement-print-table tbody tr");
  await expect(rows).toHaveCount(2);
  const sourceRow = rows.filter({ hasText: primaryTransferStoreName });
  const destinationRow = rows.filter({ hasText: secondaryTransferStoreName });
  await expect(sourceRow).toHaveCount(1);
  await expect(destinationRow).toHaveCount(1);

  await expect(sourceRow.locator(".movement-print-store")).toContainText(primaryTransferStoreName);
  await expect(sourceRow.locator(".movement-print-store")).toContainText("Source store");
  await expect(sourceRow.locator(".movement-print-qty")).toHaveText("-4");
  await expect(sourceRow.locator("[data-movement-line-value]")).toHaveText(/^-KGS\s*320\.00$/);
  await expect(destinationRow.locator(".movement-print-store")).toContainText(
    secondaryTransferStoreName,
  );
  await expect(destinationRow.locator(".movement-print-store")).toContainText("Destination store");
  await expect(destinationRow.locator(".movement-print-qty")).toHaveText("4");
  await expect(destinationRow.locator("[data-movement-line-value]")).toHaveText(/^KGS\s*320\.00$/);

  const totals = sheet.locator(".movement-print-total-row");
  await expect(totals).toHaveCount(3);
  await expect(totals.filter({ hasText: "Positions" }).locator("strong")).toHaveText("1");
  await expect(totals.filter({ hasText: "Qty" }).locator("strong")).toHaveText("0");
  await expect(totals.filter({ hasText: "Amount" }).locator("strong")).toHaveText(/^KGS\s*0\.00$/);
};

test.afterEach(async ({ pageAudit }, testInfo) => {
  await attachAuditOnFailure(testInfo, pageAudit);
});

test("@inventory-transfer-balance transfer detail and print preserve balanced legs after reload", async ({
  page,
  pageAudit,
}) => {
  await gotoDirect(page, transferMovementDetailPath);
  await assertPathname(page, transferMovementDetailPath);
  await assertStablePage(page, pageAudit);
  await assertTransferDetailLegs(page);

  pageAudit.navigationRequests.length = 0;
  const reloadedDetail = await page.reload({ waitUntil: "domcontentloaded" });
  expect(reloadedDetail).not.toBeNull();
  expect(reloadedDetail!.status()).toBeLessThan(500);
  await assertPathname(page, transferMovementDetailPath);
  await assertStablePage(page, pageAudit);
  await assertTransferDetailLegs(page);

  pageAudit.navigationRequests.length = 0;
  await gotoDirect(page, transferMovementPrintPath);
  await assertPathname(page, transferMovementPrintPath);
  await assertStablePage(page, pageAudit);
  await assertTransferPrintLegs(page);

  pageAudit.navigationRequests.length = 0;
  const reloadedPrint = await page.reload({ waitUntil: "domcontentloaded" });
  expect(reloadedPrint).not.toBeNull();
  expect(reloadedPrint!.status()).toBeLessThan(500);
  await assertPathname(page, transferMovementPrintPath);
  await assertStablePage(page, pageAudit);
  await assertTransferPrintLegs(page);
});
