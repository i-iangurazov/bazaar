import { readFile } from "node:fs/promises";

import type { Download, Locator, Page } from "@playwright/test";
import * as XLSX from "xlsx";

import {
  authenticatedAccountingFixture,
  type AuthenticatedWeightedCostCase,
  weightedCostInitialDocumentPath,
  weightedCostReceiptDocumentPath,
} from "./accounting-contract";
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

type ExportRecord = Record<string, string>;

const parseDelimitedRows = (input: string, delimiter = ";") => {
  const text = input.replace(/^\ufeff/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      row.push(value);
      value = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += character;
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
};

const toExportRecords = (rows: Array<Array<string | number>>) => {
  const [rawHeader, ...body] = rows;
  if (!rawHeader) throw new Error("Downloaded export does not contain a header row.");
  const header = rawHeader.map(String);
  return body.map((row) =>
    Object.fromEntries(header.map((column, index) => [column, String(row[index] ?? "")])),
  );
};

const readDownload = async (download: Download) => {
  const path = await download.path();
  if (!path)
    throw new Error(`Playwright did not expose a path for ${download.suggestedFilename()}.`);
  return readFile(path);
};

const gotoReadOnly = async (page: Page, pageAudit: AuthenticatedPageAudit, path: string) => {
  pageAudit.navigationRequests.length = 0;
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `direct navigation to ${path} must return a document`).not.toBeNull();
  expect(response?.ok(), `direct navigation to ${path} must succeed`).toBe(true);
  await assertVisibleTerminalHeading(page);
  assertNoRedirectLoop(pageAudit);
};

const assertWeightedCostProduct = async (page: Page, fixture: AuthenticatedWeightedCostCase) => {
  await expect(page.getByRole("heading", { level: 1, name: fixture.productName })).toBeVisible();

  const summary = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: "Product summary" }) })
    .first();
  await expect(summary).toBeVisible();
  await expect(summary.getByText("On hand", { exact: true }).locator("..")).toContainText(
    String(fixture.expectedQuantity),
  );

  const profitability = page
    .getByRole("heading", { level: 3, name: "Profitability" })
    .locator("../..");
  await expect(profitability).toBeVisible();
  await expect(profitability.getByText("Avg cost", { exact: true }).locator("..")).toContainText(
    fixture.expectedAverageCostKgs.toFixed(2),
  );
};

const assertMovementValue = async (
  page: Page,
  fixture: AuthenticatedWeightedCostCase,
  expected: { quantity: number; unitCostKgs: number; valueKgs: number },
) => {
  const summary = page
    .locator("div.rounded-xl")
    .filter({ has: page.getByRole("heading", { level: 3, name: "Document summary" }) })
    .first();
  await expect(summary).toBeVisible();
  await expect(summary.getByText("Qty", { exact: true }).locator("..")).toContainText(
    String(expected.quantity),
  );
  await expect(summary.getByText("Amount", { exact: true }).locator("..")).toContainText(
    expected.valueKgs.toFixed(2),
  );

  const movementRow = page
    .getByRole("table")
    .getByRole("row")
    .filter({
      has: page.getByRole("link", { name: fixture.productName, exact: true }),
    });
  await expect(movementRow).toHaveCount(1);
  await expect(movementRow.getByRole("cell").nth(3)).toHaveText(String(expected.quantity));
  await expect(movementRow.locator("[data-movement-unit-cost]")).toContainText(
    expected.unitCostKgs.toFixed(2),
  );
  await expect(movementRow.locator("[data-movement-line-value]")).toContainText(
    expected.valueKgs.toFixed(2),
  );
};

const exportProductsCsv = async (page: Page) => {
  await page.getByRole("button", { name: "More actions", exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Export CSV", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export products" });
  await expect(dialog).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^products-en.*\.csv$/);
  return toExportRecords(parseDelimitedRows((await readDownload(download)).toString("utf8")));
};

const chooseOption = async (page: Page, trigger: Locator, option: string) => {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
};

const setShrinkageScope = async (page: Page, storeName: string) => {
  const fixture = authenticatedAccountingFixture.shrinkage;
  await page.getByLabel("From date").fill(fixture.businessDate);
  await page.getByLabel("To date").fill(fixture.businessDate);
  await chooseOption(page, page.getByRole("combobox", { name: "Select store" }), storeName);
};

const shrinkageCard = (page: Page) =>
  page
    .locator("div.rounded-xl")
    .filter({ has: page.getByRole("heading", { level: 3, name: "Shrinkage" }) })
    .first();

const assertShrinkageRow = async (page: Page) => {
  const fixture = authenticatedAccountingFixture.shrinkage;
  const row = shrinkageCard(page).getByRole("row").filter({ hasText: fixture.productName });
  await expect(row).toHaveCount(1);
  const cells = row.getByRole("cell");
  await expect(cells.nth(0)).toHaveText(authenticatedAccountingFixture.storeName);
  await expect(cells.nth(1)).toHaveText(fixture.productName);
  await expect(cells.nth(3)).toHaveText(fixture.reason);
  await expect(cells.nth(5)).toHaveText(String(fixture.quantity));
  await expect(cells.nth(6)).toContainText(fixture.valueKgs.toFixed(2));
  await expect(cells.nth(7)).toHaveText("Aug 31, 2026, 12:00 AM");
  await expect(cells.nth(8)).toHaveText(fixture.movementId);
  await expect(cells.nth(9)).toHaveText("1");
  return row;
};

const assertShrinkageExportRecord = (records: ExportRecord[]) => {
  const fixture = authenticatedAccountingFixture.shrinkage;
  const record = records.find((candidate) => candidate["Movement IDs"] === fixture.movementId);
  expect(record, `export must contain movement ${fixture.movementId}`).toBeDefined();
  expect(record?.Store).toBe(authenticatedAccountingFixture.storeName);
  expect(record?.Product).toBe(fixture.productName);
  expect(record?.Reason).toBe(fixture.reason);
  expect(Number(record?.Qty)).toBe(fixture.quantity);
  expect(Number(record?.["Value (KGS)"])).toBeCloseTo(fixture.valueKgs, 2);
  expect(record?.["Occurred at"]).toBe(fixture.occurredAt);
  expect(record?.["Last updated at"]).toBe(fixture.occurredAt);
  expect(record?.["Document ID"]).toBe(fixture.referenceId);
  expect(record?.["Audit movements"]).toBe("1");
};

test.afterEach(async ({ pageAudit }, testInfo) => {
  await attachAuditOnFailure(testInfo, pageAudit);
});

test("BZR-PRD-001 weighted cost UI, receipt value, and product CSV reconcile", async ({
  page,
  pageAudit,
}, testInfo) => {
  for (const fixture of authenticatedAccountingFixture.weightedCostCases) {
    await gotoReadOnly(page, pageAudit, `/products/${fixture.productId}`);
    await assertWeightedCostProduct(page, fixture);
    await assertNoRootOverflow(page);

    await gotoReadOnly(page, pageAudit, weightedCostInitialDocumentPath(fixture));
    await assertMovementValue(page, fixture, {
      quantity: fixture.initialQuantity,
      unitCostKgs: fixture.initialUnitCostKgs,
      valueKgs: fixture.initialValueKgs,
    });
    await assertNoRootOverflow(page);

    await gotoReadOnly(page, pageAudit, weightedCostReceiptDocumentPath(fixture));
    await assertMovementValue(page, fixture, {
      quantity: fixture.receiptQuantity,
      unitCostKgs: fixture.receiptUnitCostKgs,
      valueKgs: fixture.receiptValueKgs,
    });
    await assertNoRootOverflow(page);
  }

  await gotoReadOnly(page, pageAudit, "/products");
  const records = await exportProductsCsv(page);
  for (const fixture of authenticatedAccountingFixture.weightedCostCases) {
    const record = records.find((candidate) => candidate.SKU === fixture.sku);
    expect(record, `product CSV must contain ${fixture.sku}`).toBeDefined();
    expect(record?.["Название"]).toBe(fixture.productName);
    expect(Number(record?.["Цена закупки"])).toBeCloseTo(fixture.expectedAverageCostKgs, 2);
    expect(Number(record?.["Себестоимость"])).toBeCloseTo(fixture.expectedAverageCostKgs, 2);
  }

  await assertNoRootOverflow(page);
  assertCleanPageAudit(pageAudit);
  await testInfo.attach("BZR-PRD-001-products-and-export", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("REPORTS-001 posted write-off persists, stays store-scoped, and reconciles CSV/XLSX", async ({
  page,
  pageAudit,
}, testInfo) => {
  const fixture = authenticatedAccountingFixture.shrinkage;
  await gotoReadOnly(page, pageAudit, "/reports");
  await setShrinkageScope(page, authenticatedAccountingFixture.storeName);
  await assertShrinkageRow(page);

  pageAudit.navigationRequests.length = 0;
  const reloadResponse = await page.reload({ waitUntil: "domcontentloaded" });
  expect(reloadResponse?.ok(), "reports reload must succeed").toBe(true);
  await assertVisibleTerminalHeading(page);
  assertNoRedirectLoop(pageAudit);

  await setShrinkageScope(page, authenticatedAccountingFixture.storeName);
  await assertShrinkageRow(page);

  await chooseOption(
    page,
    page.getByRole("combobox", { name: "Select store" }),
    authenticatedAccountingFixture.otherStoreName,
  );
  await expect(shrinkageCard(page).getByText(fixture.productName, { exact: true })).toHaveCount(0);

  await chooseOption(
    page,
    page.getByRole("combobox", { name: "Select store" }),
    authenticatedAccountingFixture.storeName,
  );
  await assertShrinkageRow(page);

  const csvDownloadPromise = page.waitForEvent("download");
  await shrinkageCard(page).getByRole("button", { name: "Export CSV", exact: true }).click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toMatch(/^shrinkage-2026-08-31-2026-08-31-en.*\.csv$/);
  assertShrinkageExportRecord(
    toExportRecords(parseDelimitedRows((await readDownload(csvDownload)).toString("utf8"))),
  );

  await chooseOption(page, page.getByRole("combobox", { name: "Format label" }), "XLSX");
  const xlsxDownloadPromise = page.waitForEvent("download");
  await shrinkageCard(page).getByRole("button", { name: "Export xlsx", exact: true }).click();
  const xlsxDownload = await xlsxDownloadPromise;
  expect(xlsxDownload.suggestedFilename()).toMatch(/^shrinkage-2026-08-31-2026-08-31-en.*\.xlsx$/);
  const workbook = XLSX.read(await readDownload(xlsxDownload), { type: "buffer" });
  const worksheetName = workbook.SheetNames[0];
  if (!worksheetName || !workbook.Sheets[worksheetName]) {
    throw new Error("Shrinkage workbook does not contain its export worksheet.");
  }
  const xlsxRows = XLSX.utils.sheet_to_json<Array<string | number>>(
    workbook.Sheets[worksheetName],
    { header: 1, raw: false, defval: "" },
  );
  assertShrinkageExportRecord(toExportRecords(xlsxRows));

  await assertNoRootOverflow(page);
  assertCleanPageAudit(pageAudit);
  await testInfo.attach("REPORTS-001-shrinkage-and-exports", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
