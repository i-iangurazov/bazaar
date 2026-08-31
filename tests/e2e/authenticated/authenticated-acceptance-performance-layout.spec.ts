import type { Page, TestInfo } from "@playwright/test";

import { authenticatedE2EIds } from "./contract";
import {
  assertCleanPageAudit,
  assertNoRootOverflow,
  attachAuditOnFailure,
  expect,
  test,
} from "./test-fixtures";

const performanceBudgetsMs = {
  coldDocument: 10_000,
  clientNavigation: 5_000,
  productSearch: 3_000,
} as const;
const maximumCumulativeLayoutShift = 0.1;

const gotoDocument = async (page: Page, path: string) => {
  const startedAt = performance.now();
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  const wallTimeMs = performance.now() - startedAt;
  expect(response, `${path} must return a document`).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  return wallTimeMs;
};

test.afterEach(async ({ pageAudit }, testInfo: TestInfo) => {
  await attachAuditOnFailure(testInfo, pageAudit);
});

test("BZR-REQ-0211/0212/0214/0219 production navigation, search, and CLS stay within budgets", async ({
  page,
  pageAudit,
}, testInfo) => {
  await page.addInitScript(() => {
    const metricsWindow = window as Window & { __qaCumulativeLayoutShift?: number };
    metricsWindow.__qaCumulativeLayoutShift = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (!shift.hadRecentInput) {
          metricsWindow.__qaCumulativeLayoutShift =
            (metricsWindow.__qaCumulativeLayoutShift ?? 0) + (shift.value ?? 0);
        }
      }
    });
    try {
      observer.observe({ type: "layout-shift", buffered: true });
    } catch {
      // Unsupported browsers report no synthetic CLS rather than failing app navigation.
    }
  });

  const coldDocumentMs = await gotoDocument(page, "/dashboard");
  expect(coldDocumentMs, "dashboard production document budget").toBeLessThanOrEqual(
    performanceBudgetsMs.coldDocument,
  );
  const navigationEntry = await page.evaluate(() => {
    const entry = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    return entry
      ? {
          domContentLoadedMs: entry.domContentLoadedEventEnd,
          responseEndMs: entry.responseEnd,
          encodedBodyBytes: entry.encodedBodySize,
          transferBytes: entry.transferSize,
        }
      : null;
  });
  expect(navigationEntry, "Navigation Timing must be available").not.toBeNull();
  expect(navigationEntry!.domContentLoadedMs).toBeLessThanOrEqual(
    performanceBudgetsMs.coldDocument,
  );

  const productsLink = page.getByRole("link", { name: "Products", exact: true }).first();
  await expect(productsLink).toBeVisible();
  const clientNavigationStartedAt = performance.now();
  await productsLink.click();
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  const clientNavigationMs = performance.now() - clientNavigationStartedAt;
  expect(clientNavigationMs, "dashboard-to-products client navigation budget").toBeLessThanOrEqual(
    performanceBudgetsMs.clientNavigation,
  );

  const searchInput = page.locator('input[placeholder^="Search by"]:visible').first();
  await expect(searchInput).toBeVisible();
  const productSearchStartedAt = performance.now();
  await searchInput.fill("QA-BAZAAR-AUTH-PRIMARY");
  await expect(searchInput).toHaveValue("QA-BAZAAR-AUTH-PRIMARY");
  await expect(
    page.getByText("QA-BAZAAR Authenticated Product", { exact: true }).first(),
  ).toBeVisible();
  const productSearchMs = performance.now() - productSearchStartedAt;
  expect(productSearchMs, "product search-to-result budget").toBeLessThanOrEqual(
    performanceBudgetsMs.productSearch,
  );

  await page.waitForTimeout(500);
  const cumulativeLayoutShift = await page.evaluate(
    () =>
      (window as Window & { __qaCumulativeLayoutShift?: number }).__qaCumulativeLayoutShift ?? 0,
  );
  expect(cumulativeLayoutShift, "local production cumulative layout shift").toBeLessThanOrEqual(
    maximumCumulativeLayoutShift,
  );
  await assertNoRootOverflow(page);
  assertCleanPageAudit(pageAudit);

  await testInfo.attach("authenticated-production-performance", {
    body: JSON.stringify(
      {
        budgets: { ...performanceBudgetsMs, maximumCumulativeLayoutShift },
        measurements: {
          coldDocumentMs,
          clientNavigationMs,
          productSearchMs,
          cumulativeLayoutShift,
          navigationEntry,
        },
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});

test("LAYOUT-001 valued movement tables contain overflow and keep actions reachable", async ({
  page,
  pageAudit,
}) => {
  const documentKey = `STOCK_RECEIVING:STOCK_RECEIVING:${authenticatedE2EIds.receivingReference}`;
  const path = `/inventory/movements/${encodeURIComponent(documentKey)}`;

  for (const viewport of [
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await gotoDocument(page, path);
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    const containment = await table.evaluate((node) => {
      const container = node.parentElement;
      if (!container) return null;
      const style = getComputedStyle(container);
      return {
        containerClientWidth: container.clientWidth,
        containerScrollWidth: container.scrollWidth,
        overflowX: style.overflowX,
        tableScrollWidth: node.scrollWidth,
      };
    });
    expect(containment, `${viewport.width}px table must have a container`).not.toBeNull();
    expect(containment!.tableScrollWidth).toBeGreaterThanOrEqual(containment!.containerClientWidth);
    expect(["auto", "scroll"]).toContain(containment!.overflowX);
    if (viewport.width < 1120) {
      expect(containment!.containerScrollWidth).toBeGreaterThan(containment!.containerClientWidth);
    }
    await assertNoRootOverflow(page);

    const actions = page.getByRole("button", { name: "Document actions", exact: true });
    await expect(actions).toBeVisible();
    await actions.click();
    await expect(page.getByRole("menuitem", { name: "Print waybill", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  }

  assertCleanPageAudit(pageAudit);
});
