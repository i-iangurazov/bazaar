import { readFile } from "node:fs/promises";

import type { Download, Locator, Page, TestInfo } from "@playwright/test";
import * as XLSX from "xlsx";

import { authenticatedAccountingFixture } from "./accounting-contract";
import {
  assertCleanPageAudit,
  assertNoRedirectLoop,
  assertNoRootOverflow,
  attachAuditOnFailure,
  expect,
  test,
  type AuthenticatedPageAudit,
} from "./test-fixtures";

type ReportLocale = "en" | "ru" | "kg";
type ExportRecord = Record<string, string>;
type TimingMeasurement = {
  locale: ReportLocale;
  phase: "render" | "csv-export" | "xlsx-export";
  elapsedMs: number;
  budgetMs: number;
};

const productionTimingBudgetsMs = {
  render: 10_000,
  csvExport: 5_000,
  xlsxExport: 10_000,
} as const;

const localeExpectations = {
  en: {
    title: "Reports",
    dateFrom: "From date",
    dateTo: "To date",
    selectStore: "Select store",
    allStores: "All stores",
    shrinkage: "Shrinkage",
    empty: "No shrinkage.",
    format: "Format label",
    exportCsv: "Export CSV",
    exportXlsx: "Export xlsx",
    dateTime: "Aug 31, 2026, 12:00 AM",
    currency: /KGS\s*160\.92/,
    columns: [
      "Store",
      "Product",
      "Variant",
      "Reason",
      "Operator",
      "Qty",
      "Value (KGS)",
      "Occurred at",
      "Last updated at",
      "Document ID",
      "Movement IDs",
      "Audit movements",
    ],
  },
  ru: {
    title: "Отчеты",
    dateFrom: "Дата с",
    dateTo: "Дата по",
    selectStore: "Выберите магазин",
    allStores: "Все магазины",
    shrinkage: "Списания",
    empty: "Списаний нет.",
    format: "Формат",
    exportCsv: "Экспорт CSV",
    exportXlsx: "Экспорт XLSX",
    dateTime: "31 авг. 2026 г., 00:00",
    currency: /160,92\s*KGS/,
    columns: [
      "Магазин",
      "Товар",
      "Вариант",
      "Причина",
      "Ответственный",
      "Количество",
      "Стоимость (KGS)",
      "Дата и время",
      "Последнее изменение",
      "ID документа",
      "ID движений",
      "Аудит-движений",
    ],
  },
  kg: {
    title: "Отчёттор",
    dateFrom: "Баштапкы дата",
    dateTo: "Акыркы дата",
    selectStore: "Дүкөндү тандаңыз",
    allStores: "Бардык дүкөндөр",
    shrinkage: "Списаниялар",
    empty: "Списаниялар жок.",
    format: "Формат",
    exportCsv: "CSV экспорт",
    exportXlsx: "XLSX экспорт",
    dateTime: "2026-ж. 31-авг. 00:00",
    currency: /160,92\s*сом/,
    columns: [
      "Дүкөн",
      "Буюм",
      "Вариант",
      "Себеби",
      "Жооптуу",
      "Саны",
      "Наркы (KGS)",
      "Дата жана убакыт",
      "Акыркы өзгөртүү",
      "Документтин ID'си",
      "Кыймылдардын ID'лери",
      "Аудит кыймылдары",
    ],
  },
} as const;

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
  if (!rawHeader) throw new Error("Downloaded report export does not contain a header row.");
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

const chooseOption = async (page: Page, trigger: Locator, option: string) => {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
};

const setLocaleCookie = async (page: Page, baseURL: string, locale: ReportLocale) => {
  await page.context().addCookies([
    {
      name: "NEXT_LOCALE",
      value: locale,
      url: baseURL,
      httpOnly: true,
      secure: new URL(baseURL).protocol === "https:",
      sameSite: "Lax",
    },
  ]);
};

const gotoReports = async (page: Page, pageAudit: AuthenticatedPageAudit, locale: ReportLocale) => {
  pageAudit.navigationRequests.length = 0;
  const response = await page.goto("/reports", { waitUntil: "domcontentloaded" });
  expect(response?.ok(), "reports must return a successful document").toBe(true);
  await expect(
    page.getByRole("heading", { level: 1, name: localeExpectations[locale].title }),
  ).toBeVisible();
  assertNoRedirectLoop(pageAudit);
};

const shrinkageCard = (page: Page, locale: ReportLocale) =>
  page
    .getByRole("heading", { level: 3, name: localeExpectations[locale].shrinkage })
    .locator("../..");

const setRangeAndStore = async (
  page: Page,
  locale: ReportLocale,
  input: { from: string; to: string; store: string },
) => {
  const copy = localeExpectations[locale];
  await page.getByLabel(copy.dateFrom).fill(input.from);
  await page.getByLabel(copy.dateTo).fill(input.to);
  await chooseOption(page, page.getByRole("combobox", { name: copy.selectStore }), input.store);
};

const findFixtureRow = (page: Page, locale: ReportLocale) =>
  shrinkageCard(page, locale)
    .getByRole("row")
    .filter({ hasText: authenticatedAccountingFixture.shrinkage.productName });

const assertFixtureRow = async (page: Page, locale: ReportLocale) => {
  const fixture = authenticatedAccountingFixture.shrinkage;
  const copy = localeExpectations[locale];
  const row = findFixtureRow(page, locale);
  await expect(row).toHaveCount(1);
  const cells = row.getByRole("cell");
  await expect(cells.nth(0)).toHaveText(authenticatedAccountingFixture.storeName);
  await expect(cells.nth(1)).toHaveText(fixture.productName);
  await expect(cells.nth(3)).toHaveText(fixture.reason);
  await expect(cells.nth(5)).toHaveText(String(fixture.quantity));
  await expect(cells.nth(6)).toHaveText(copy.currency);
  await expect(cells.nth(7)).toHaveText(copy.dateTime);
  await expect(cells.nth(8)).toHaveText(fixture.movementId);
  return row;
};

const assertExportRecord = (
  records: ExportRecord[],
  columns: readonly string[],
  expectedHeader: readonly string[],
) => {
  expect(columns).toEqual(expectedHeader);
  const fixture = authenticatedAccountingFixture.shrinkage;
  const record = records.find((candidate) => candidate[expectedHeader[10]!] === fixture.movementId);
  expect(record, `export must contain movement ${fixture.movementId}`).toBeDefined();
  expect(record?.[expectedHeader[0]!]).toBe(authenticatedAccountingFixture.storeName);
  expect(record?.[expectedHeader[1]!]).toBe(fixture.productName);
  expect(record?.[expectedHeader[3]!]).toBe(fixture.reason);
  expect(Number(record?.[expectedHeader[5]!])).toBe(fixture.quantity);
  expect(Number(record?.[expectedHeader[6]!])).toBeCloseTo(fixture.valueKgs, 2);
  expect(record?.[expectedHeader[7]!]).toBe(fixture.occurredAt);
  expect(record?.[expectedHeader[8]!]).toBe(fixture.occurredAt);
  expect(record?.[expectedHeader[9]!]).toBe(fixture.referenceId);
  expect(record?.[expectedHeader[11]!]).toBe("1");
};

const downloadReport = async (page: Page, locale: ReportLocale, format: "csv" | "xlsx") => {
  const copy = localeExpectations[locale];
  if (format === "xlsx") {
    await chooseOption(page, page.getByRole("combobox", { name: copy.format }), "XLSX");
  }
  const downloadPromise = page.waitForEvent("download");
  await shrinkageCard(page, locale)
    .getByRole("button", {
      name: format === "csv" ? copy.exportCsv : copy.exportXlsx,
      exact: true,
    })
    .click();
  return downloadPromise;
};

const attachTimings = async (testInfo: TestInfo, timings: TimingMeasurement[]) => {
  await testInfo.attach("report-operations-production-timings", {
    body: Buffer.from(
      JSON.stringify(
        {
          environment: "local production build",
          budgetsMs: productionTimingBudgetsMs,
          measurements: timings,
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });
};

test.afterEach(async ({ pageAudit }, testInfo) => {
  await attachAuditOnFailure(testInfo, pageAudit);
});

test("BZR-REQ-0054/0164/0165 report dates reject impossible values and reconcile inclusive past/future boundaries", async ({
  page,
  pageAudit,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Authenticated report acceptance requires baseURL.");
  await setLocaleCookie(page, baseURL, "en");
  await gotoReports(page, pageAudit, "en");

  await setRangeAndStore(page, "en", {
    from: authenticatedAccountingFixture.shrinkage.businessDate,
    to: authenticatedAccountingFixture.shrinkage.businessDate,
    store: localeExpectations.en.allStores,
  });
  await assertFixtureRow(page, "en");

  const fromInput = page.getByLabel(localeExpectations.en.dateFrom);
  await expect(fromInput).toHaveAttribute("type", "date");
  expect(
    await fromInput.evaluate((node) => {
      const input = node as HTMLInputElement;
      input.value = "2026-02-30";
      return input.value;
    }),
    "the native date control must sanitize an impossible calendar date",
  ).toBe("");
  await fromInput.fill(authenticatedAccountingFixture.shrinkage.businessDate);
  await assertFixtureRow(page, "en");

  await chooseOption(
    page,
    page.getByRole("combobox", { name: localeExpectations.en.selectStore }),
    authenticatedAccountingFixture.otherStoreName,
  );
  await expect(findFixtureRow(page, "en")).toHaveCount(0);
  await expect(shrinkageCard(page, "en").getByText(localeExpectations.en.empty)).toBeVisible();

  await chooseOption(
    page,
    page.getByRole("combobox", { name: localeExpectations.en.selectStore }),
    authenticatedAccountingFixture.storeName,
  );
  await assertFixtureRow(page, "en");

  await page.getByLabel(localeExpectations.en.dateFrom).fill("2026-08-30");
  await page.getByLabel(localeExpectations.en.dateTo).fill("2026-08-30");
  await expect(shrinkageCard(page, "en").getByText(localeExpectations.en.empty)).toBeVisible();

  await page.getByLabel(localeExpectations.en.dateFrom).fill("2026-09-01");
  await page.getByLabel(localeExpectations.en.dateTo).fill("2026-09-01");
  await expect(shrinkageCard(page, "en").getByText(localeExpectations.en.empty)).toBeVisible();

  await setRangeAndStore(page, "en", {
    from: authenticatedAccountingFixture.shrinkage.businessDate,
    to: authenticatedAccountingFixture.shrinkage.businessDate,
    store: authenticatedAccountingFixture.storeName,
  });
  await assertFixtureRow(page, "en");
  await assertNoRootOverflow(page);
  assertCleanPageAudit(pageAudit);
});

test("BZR-REQ-0167 guaranteed-empty range renders a useful terminal report state", async ({
  page,
  pageAudit,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Authenticated report acceptance requires baseURL.");
  await setLocaleCookie(page, baseURL, "en");
  await gotoReports(page, pageAudit, "en");
  await setRangeAndStore(page, "en", {
    from: "1999-01-01",
    to: "1999-01-01",
    store: authenticatedAccountingFixture.storeName,
  });

  const card = shrinkageCard(page, "en");
  await expect(card.getByText(localeExpectations.en.empty, { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: localeExpectations.en.exportCsv })).toBeDisabled();
  await expect(card.getByRole("row")).toHaveCount(0);
  await assertNoRootOverflow(page);
  assertCleanPageAudit(pageAudit);
});

test("BZR-REQ-0170/0209/0216/0217 localized reports and exports meet production budgets", async ({
  page,
  pageAudit,
  baseURL,
}, testInfo) => {
  test.skip(
    process.env.AUTHENTICATED_E2E_EXPECT_PRODUCTION !== "1",
    "Timing evidence is valid only against the local production build.",
  );
  if (!baseURL) throw new Error("Authenticated report acceptance requires baseURL.");
  const timings: TimingMeasurement[] = [];

  try {
    for (const locale of ["en", "ru", "kg"] as const) {
      const copy = localeExpectations[locale];
      await setLocaleCookie(page, baseURL, locale);
      const renderStartedAt = performance.now();
      await gotoReports(page, pageAudit, locale);
      await setRangeAndStore(page, locale, {
        from: authenticatedAccountingFixture.shrinkage.businessDate,
        to: authenticatedAccountingFixture.shrinkage.businessDate,
        store: authenticatedAccountingFixture.storeName,
      });
      await assertFixtureRow(page, locale);
      const renderElapsedMs = Math.round(performance.now() - renderStartedAt);
      timings.push({
        locale,
        phase: "render",
        elapsedMs: renderElapsedMs,
        budgetMs: productionTimingBudgetsMs.render,
      });
      expect(renderElapsedMs, `${locale} report render budget`).toBeLessThanOrEqual(
        productionTimingBudgetsMs.render,
      );

      const csvStartedAt = performance.now();
      const csvDownload = await downloadReport(page, locale, "csv");
      const csvElapsedMs = Math.round(performance.now() - csvStartedAt);
      timings.push({
        locale,
        phase: "csv-export",
        elapsedMs: csvElapsedMs,
        budgetMs: productionTimingBudgetsMs.csvExport,
      });
      expect(csvElapsedMs, `${locale} CSV export budget`).toBeLessThanOrEqual(
        productionTimingBudgetsMs.csvExport,
      );
      expect(csvDownload.suggestedFilename()).toMatch(
        new RegExp(`^shrinkage-2026-08-31-2026-08-31-${locale}.*\\.csv$`),
      );
      const csvBuffer = await readDownload(csvDownload);
      expect([...csvBuffer.subarray(0, 3)], `${locale} CSV UTF-8 BOM`).toEqual([0xef, 0xbb, 0xbf]);
      const csvText = csvBuffer.toString("utf8");
      expect(csvText).not.toContain("�");
      expect(csvText).toContain(copy.columns[0]);
      expect(csvText).toContain(authenticatedAccountingFixture.shrinkage.reason);
      const csvRows = parseDelimitedRows(csvText);
      assertExportRecord(toExportRecords(csvRows), csvRows[0] ?? [], copy.columns);

      const xlsxStartedAt = performance.now();
      const xlsxDownload = await downloadReport(page, locale, "xlsx");
      const xlsxElapsedMs = Math.round(performance.now() - xlsxStartedAt);
      timings.push({
        locale,
        phase: "xlsx-export",
        elapsedMs: xlsxElapsedMs,
        budgetMs: productionTimingBudgetsMs.xlsxExport,
      });
      expect(xlsxElapsedMs, `${locale} XLSX export budget`).toBeLessThanOrEqual(
        productionTimingBudgetsMs.xlsxExport,
      );
      expect(xlsxDownload.suggestedFilename()).toMatch(
        new RegExp(`^shrinkage-2026-08-31-2026-08-31-${locale}.*\\.xlsx$`),
      );
      const workbook = XLSX.read(await readDownload(xlsxDownload), { type: "buffer" });
      const worksheetName = workbook.SheetNames[0];
      if (!worksheetName || !workbook.Sheets[worksheetName]) {
        throw new Error(`${locale} shrinkage workbook is missing its export worksheet.`);
      }
      const xlsxRows = XLSX.utils.sheet_to_json<Array<string | number>>(
        workbook.Sheets[worksheetName],
        { header: 1, raw: false, defval: "" },
      );
      assertExportRecord(toExportRecords(xlsxRows), (xlsxRows[0] ?? []).map(String), copy.columns);
      await assertNoRootOverflow(page);
    }
    assertCleanPageAudit(pageAudit);
  } finally {
    await attachTimings(testInfo, timings);
  }
});
