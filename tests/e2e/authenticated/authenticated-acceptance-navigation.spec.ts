import type { Page, TestInfo } from "@playwright/test";

import { authenticatedE2EIds } from "./contract";
import {
  authenticatedDynamicRoutes,
  authenticatedQueryStateRoutes,
  canonicalAuthenticatedRoutes,
  expectedLocationForAuthenticatedRoute,
  type AuthenticatedRouteDefinition,
  type AuthenticatedRouteLocation,
} from "./route-inventory";
import {
  assertCleanPageAudit,
  assertDocumentTitleMatchesHeading,
  assertNoRootOverflow,
  assertVisibleTerminalHeading,
  attachAuditOnFailure,
  expect,
  test,
  type AuthenticatedPageAudit,
} from "./test-fixtures";

const compatibilityRoutes = canonicalAuthenticatedRoutes.filter((route) =>
  route.id.endsWith("-compatibility"),
);

const navigationStateRoutes: readonly AuthenticatedRouteDefinition[] = [
  ...compatibilityRoutes,
  ...authenticatedQueryStateRoutes,
];

const shellNavigationTargets = [
  ["dashboard", "/dashboard"],
  ["pos", "/pos"],
  ["products", "/products"],
  ["inventoryOverview", "/inventory"],
  ["productMovements", "/inventory/movements"],
  ["stockReceiving", "/inventory/receiving"],
  ["stockTransfer", "/inventory/transfers"],
  ["stockWriteOff", "/inventory/write-offs"],
  ["stockCounts", "/inventory/counts"],
  ["salesOrders", "/sales/orders"],
  ["purchaseOrders", "/purchase-orders"],
  ["customers", "/customers"],
  ["suppliers", "/suppliers"],
  ["stores", "/stores"],
  ["integrations", "/operations/integrations"],
  ["imports", "/settings/import"],
  ["onboarding", "/onboarding"],
  ["reports", "/reports"],
  ["adminMetrics", "/admin/metrics"],
  ["users", "/settings/users"],
  ["printing", "/settings/printing"],
  ["storeGroups", "/settings/store-groups"],
  ["attributes", "/settings/attributes"],
  ["categories", "/settings/categories"],
  ["units", "/settings/units"],
  ["adminJobs", "/admin/jobs"],
  ["billing", "/billing"],
  ["adminSupport", "/admin/support"],
  ["help", "/help"],
  ["whatsNew", "/settings/whats-new"],
] as const;

const locationSnapshot = (page: Page) => {
  const current = new URL(page.url());
  return {
    pathname: current.pathname,
    search: current.search,
    hash: current.hash,
  };
};

const assertLocation = async (page: Page, expected: AuthenticatedRouteLocation) => {
  await expect
    .poll(() => locationSnapshot(page))
    .toEqual({
      pathname: expected.pathname,
      search: expected.search ?? "",
      hash: expected.hash ?? "",
    });
};

const assertStableReadOnlyPage = async (page: Page, audit: AuthenticatedPageAudit) => {
  await assertVisibleTerminalHeading(page);
  await assertDocumentTitleMatchesHeading(page);
  await assertNoRootOverflow(page);
  await page.waitForTimeout(250);
  await assertVisibleTerminalHeading(page);
  await assertDocumentTitleMatchesHeading(page);
  assertCleanPageAudit(audit);
};

const gotoDocument = async (page: Page, path: string) => {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `${path} must return a document`).not.toBeNull();
  expect(response!.status(), `${path} must not fail at the document boundary`).toBeLessThan(500);
};

const expandAllSidebarGroups = async (page: Page) => {
  const collapsedGroups = page.locator('aside[data-sidebar] button[aria-expanded="false"]');
  for (let index = 0; index < 10 && (await collapsedGroups.count()) > 0; index += 1) {
    await collapsedGroups.first().click();
  }
  await expect(collapsedGroups).toHaveCount(0);
};

test.afterEach(async ({ pageAudit }, testInfo: TestInfo) => {
  await attachAuditOnFailure(testInfo, pageAudit);
});

for (const route of navigationStateRoutes) {
  test(`compatibility state survives reload and browser history: ${route.id}`, async ({
    page,
    pageAudit,
  }) => {
    const expected = expectedLocationForAuthenticatedRoute(route);

    await gotoDocument(page, "/dashboard");
    await assertLocation(page, { pathname: "/dashboard" });
    await gotoDocument(page, route.path);
    await assertLocation(page, expected);
    await assertStableReadOnlyPage(page, pageAudit);

    await page.reload({ waitUntil: "domcontentloaded" });
    await assertLocation(page, expected);
    await assertVisibleTerminalHeading(page);

    await page.goBack({ waitUntil: "domcontentloaded" });
    await assertLocation(page, { pathname: "/dashboard" });
    await assertVisibleTerminalHeading(page);

    await page.goForward({ waitUntil: "domcontentloaded" });
    await assertLocation(page, expected);
    await assertStableReadOnlyPage(page, pageAudit);
  });
}

test("inventory receive compatibility opens the real receiving workflow", async ({
  page,
  pageAudit,
}) => {
  await gotoDocument(page, "/inventory?action=receive");
  await assertLocation(page, { pathname: "/inventory/receiving" });
  await expect(page.getByRole("heading", { level: 1, name: "Stock receiving" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Add products" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Find a product" })).toBeVisible();
  await assertStableReadOnlyPage(page, pageAudit);
});

test("BZR-REQ-0201 locale prefixes cover authenticated, dynamic, and compatibility routes", async ({
  page,
  pageAudit,
  baseURL,
}) => {
  expect(baseURL).toBeTruthy();
  const prefixCases = [
    {
      input: "/ru/dashboard?source=prefix#overview",
      expected: { pathname: "/dashboard", search: "?source=prefix", hash: "#overview" },
      locale: "ru",
      language: "ru",
    },
    {
      input: `/kg/products/${authenticatedE2EIds.primaryProduct}?source=prefix#details`,
      expected: {
        pathname: `/products/${authenticatedE2EIds.primaryProduct}`,
        search: "?source=prefix",
        hash: "#details",
      },
      locale: "kg",
      language: "ky-KG",
    },
    {
      input: "/en/inventory?action=transfer",
      expected: {
        pathname: "/inventory/transfers",
        search: `?fromStoreId=${authenticatedE2EIds.primaryStore}`,
        hash: "",
      },
      locale: "en",
      language: "en-US",
    },
    {
      input: "/ky/orders",
      expected: { pathname: "/sales/orders", search: "", hash: "" },
      locale: "kg",
      language: "ky-KG",
    },
  ] as const;

  for (const routeCase of prefixCases) {
    await page.context().clearCookies({ name: "NEXT_LOCALE" });
    await gotoDocument(page, routeCase.input);
    await assertLocation(page, routeCase.expected);
    await assertStableReadOnlyPage(page, pageAudit);
    await expect(page.locator("html")).toHaveAttribute("lang", routeCase.language);
    const localeCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === "NEXT_LOCALE",
    );
    expect(localeCookie?.value).toBe(routeCase.locale);

    await page.reload({ waitUntil: "domcontentloaded" });
    await assertLocation(page, routeCase.expected);
    await assertStableReadOnlyPage(page, pageAudit);
    await expect(page.locator("html")).toHaveAttribute("lang", routeCase.language);
  }
});

for (const route of authenticatedDynamicRoutes) {
  test(`owned dynamic deep link remains terminal after refresh: ${route.id}`, async ({
    page,
    pageAudit,
  }) => {
    await gotoDocument(page, route.validPath);
    const expected = { pathname: new URL(route.validPath, "http://local").pathname };
    await assertLocation(page, expected);
    await assertStableReadOnlyPage(page, pageAudit);

    await page.reload({ waitUntil: "domcontentloaded" });
    await assertLocation(page, expected);
    await assertStableReadOnlyPage(page, pageAudit);
  });
}

for (const [tourKey, targetPath] of shellNavigationTargets) {
  test(`BZR-REQ-0003/0004 application navigation, title, active state, and Back: ${tourKey}`, async ({
    page,
    pageAudit,
  }) => {
    const startingPath = targetPath === "/dashboard" ? "/products" : "/dashboard";
    await gotoDocument(page, startingPath);
    await assertStableReadOnlyPage(page, pageAudit);
    await expandAllSidebarGroups(page);

    const link = page.locator(`a[data-tour="nav-${tourKey}"]`);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", targetPath);
    await link.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(targetPath);
    await assertStableReadOnlyPage(page, pageAudit);

    if ((await page.locator("aside[data-sidebar]").count()) > 0) {
      await expect(page.locator(`a[data-tour="nav-${tourKey}"]`)).toHaveAttribute(
        "aria-current",
        "page",
      );
    }

    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect.poll(() => new URL(page.url()).pathname).toBe(startingPath);
    await assertStableReadOnlyPage(page, pageAudit);
  });
}
