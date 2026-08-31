import { readFileSync } from "node:fs";

import type { Page, TestInfo } from "@playwright/test";

import {
  emulateBrowserZoomReflow,
  expectNoClippedInteractiveLabels,
  expectNoUncontainedHorizontalClipping,
  expectVisibleKeyboardFocus,
  tabUntilFocused,
  type BrowserZoomSnapshot,
} from "../browser-zoom-assertions";
import { browserZoomProfiles, type BrowserZoomProfile } from "../browser-zoom-contract";
import { authenticatedE2EIds } from "./contract";
import {
  assertCleanPageAudit,
  assertNoRootOverflow,
  assertVisibleInteractiveControlsNamed,
  assertVisibleTerminalHeading,
  attachAuditOnFailure,
  expect,
  test,
} from "./test-fixtures";

type SupportedLocale = "en" | "kg" | "ru";

type ReflowMessages = {
  customers: {
    title: string;
    actions: { add: string };
    fields: { name: string };
    modal: { addTitle: string };
  };
  emailMarketingWorkspace: {
    title: string;
    builder: { unavailableMessage: string; unavailableTitle: string };
    tabs: Record<"automations" | "campaigns" | "senders" | "templates", string>;
  };
  inventory: {
    movementJournal: {
      documentActions: string;
      viewDetails: string;
    };
  };
  pos: {
    entry: { sell: string };
    sell: {
      title: string;
      mobile: { addProducts: string; catalog: string; search: string };
    };
  };
  products: { name: string; newTitle: string };
};

const messagesByLocale = Object.fromEntries(
  (["en", "kg", "ru"] as const).map((locale) => [
    locale,
    JSON.parse(
      readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"),
    ) as ReflowMessages,
  ]),
) as Record<SupportedLocale, ReflowMessages>;

const documentLanguageByLocale: Record<SupportedLocale, string> = {
  en: "en-US",
  kg: "ky-KG",
  ru: "ru",
};

const setLocale = async (page: Page, baseURL: string, locale: SupportedLocale) => {
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL }]);
};

const gotoStable = async (page: Page, path: string) => {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `${path} must return a document`).not.toBeNull();
  expect(response!.status(), `${path} document status`).toBeLessThan(500);
  await assertVisibleTerminalHeading(page);
  await assertNoRootOverflow(page);
};

const attachReflowEvidence = async (
  testInfo: TestInfo,
  value: {
    profiles: Array<{ profile: BrowserZoomProfile; snapshot: BrowserZoomSnapshot }>;
    locales: SupportedLocale[];
    routes: string[];
    assertions: string[];
  },
) => {
  await testInfo.attach("bzr-req-0199-authenticated-zoom-reflow", {
    body: JSON.stringify(
      {
        requirement: "BZR-REQ-0199",
        method:
          "Chrome device-metrics override reproducing 200% browser zoom layout viewport and DPR; pinch scale remains 1",
        ...value,
        screenReaderBoundary:
          "This automation is not a formal screen-reader session and is not evidence for BZR-REQ-0200.",
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
};

test.afterEach(async ({ pageAudit }, testInfo: TestInfo) => {
  await attachAuditOnFailure(testInfo, pageAudit);
});

for (const locale of ["en", "ru", "kg"] as const) {
  test(`BZR-REQ-0199 ${locale.toUpperCase()} long application labels reflow at 200%`, async ({
    page,
    pageAudit,
    baseURL,
  }, testInfo) => {
    expect(baseURL).toBeTruthy();
    const copy = messagesByLocale[locale];
    const profile = browserZoomProfiles.desktop;
    const snapshot = await emulateBrowserZoomReflow(page, profile);
    await setLocale(page, baseURL!, locale);
    await gotoStable(page, "/operations/integrations/email-marketing");

    const workspace = page.locator('[data-email-marketing-workspace="overview"]');
    await expect(workspace).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", documentLanguageByLocale[locale]);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      copy.emailMarketingWorkspace.title,
    );
    await expect(workspace).toContainText(copy.emailMarketingWorkspace.builder.unavailableTitle);
    await expect(workspace).toContainText(copy.emailMarketingWorkspace.builder.unavailableMessage);
    await assertVisibleInteractiveControlsNamed(page);
    await expectNoUncontainedHorizontalClipping(page, workspace);
    await expectNoClippedInteractiveLabels(workspace);

    const templatesTab = workspace.getByRole("tab", {
      name: copy.emailMarketingWorkspace.tabs.templates,
      exact: true,
    });
    await tabUntilFocused(page, templatesTab);
    await expect(templatesTab).toBeFocused();
    await expectVisibleKeyboardFocus(page);
    await page.keyboard.press("Enter");
    await expect(templatesTab).toHaveAttribute("aria-selected", "true");
    await assertNoRootOverflow(page);
    await expectNoUncontainedHorizontalClipping(page, workspace);
    assertCleanPageAudit(pageAudit);

    await attachReflowEvidence(testInfo, {
      profiles: [{ profile, snapshot }],
      locales: [locale],
      routes: ["/operations/integrations/email-marketing"],
      assertions: [
        "localized long labels",
        "root overflow",
        "uncontained control clipping",
        "interactive-label clipping",
        "keyboard-reachable horizontally scrolling tabs",
        "visible focus and Enter activation",
      ],
    });
  });
}

test("BZR-REQ-0199 product form and customer modal remain operable at 200% and 320 CSS px", async ({
  page,
  pageAudit,
  baseURL,
}, testInfo) => {
  expect(baseURL).toBeTruthy();
  const profiles: Array<{ profile: BrowserZoomProfile; snapshot: BrowserZoomSnapshot }> = [];

  const desktopProfile = browserZoomProfiles.desktop;
  profiles.push({
    profile: desktopProfile,
    snapshot: await emulateBrowserZoomReflow(page, desktopProfile),
  });
  const russian = messagesByLocale.ru;
  await setLocale(page, baseURL!, "ru");
  await gotoStable(page, "/products/new");
  await expect(page.locator("html")).toHaveAttribute("lang", documentLanguageByLocale.ru);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(russian.products.newTitle);
  const productName = page
    .getByRole("textbox", { name: russian.products.name, exact: true })
    .first();
  await tabUntilFocused(page, productName);
  await expectVisibleKeyboardFocus(page);
  await page.keyboard.type("Проверка масштаба");
  await expect(productName).toHaveValue("Проверка масштаба");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await expect(productName).toHaveValue("");
  await expectNoUncontainedHorizontalClipping(page, page.locator("form"));
  await expectNoClippedInteractiveLabels(page.locator("form"));
  await assertNoRootOverflow(page);

  const narrowProfile = browserZoomProfiles.narrow;
  profiles.push({
    profile: narrowProfile,
    snapshot: await emulateBrowserZoomReflow(page, narrowProfile),
  });
  const kyrgyz = messagesByLocale.kg;
  await setLocale(page, baseURL!, "kg");
  await gotoStable(
    page,
    `/customers?storeId=${encodeURIComponent(authenticatedE2EIds.primaryStore)}`,
  );
  await expect(page.locator("html")).toHaveAttribute("lang", documentLanguageByLocale.kg);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(kyrgyz.customers.title);
  const addCustomer = page.getByRole("button", {
    name: kyrgyz.customers.actions.add,
    exact: true,
  });
  await tabUntilFocused(page, addCustomer);
  await expectVisibleKeyboardFocus(page);
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: kyrgyz.customers.modal.addTitle });
  await expect(dialog).toBeVisible();
  await expectNoUncontainedHorizontalClipping(page, dialog);
  await expectNoClippedInteractiveLabels(dialog);
  const customerName = dialog.getByRole("textbox", {
    name: kyrgyz.customers.fields.name,
    exact: true,
  });
  await tabUntilFocused(page, customerName);
  await expectVisibleKeyboardFocus(page);
  await page.keyboard.type("Масштаб текшерүү");
  await expect(customerName).toHaveValue("Масштаб текшерүү");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await expect(customerName).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(addCustomer).toBeFocused();
  await expectVisibleKeyboardFocus(page);
  await assertNoRootOverflow(page);
  assertCleanPageAudit(pageAudit);

  await attachReflowEvidence(testInfo, {
    profiles,
    locales: ["ru", "kg"],
    routes: ["/products/new", `/customers?storeId=${authenticatedE2EIds.primaryStore}`],
    assertions: [
      "form keyboard input and visible focus",
      "modal keyboard open, focus containment, input, Escape close, and focus restoration",
      "320 CSS px narrow reflow",
      "root overflow",
      "uncontained control and label clipping",
    ],
  });
});

test("BZR-REQ-0199 movement table and POS controls remain contained and operable at 200%", async ({
  page,
  pageAudit,
  baseURL,
}, testInfo) => {
  expect(baseURL).toBeTruthy();
  const profiles: Array<{ profile: BrowserZoomProfile; snapshot: BrowserZoomSnapshot }> = [];

  const tableProfile = browserZoomProfiles.wideTable;
  profiles.push({
    profile: tableProfile,
    snapshot: await emulateBrowserZoomReflow(page, tableProfile),
  });
  const english = messagesByLocale.en;
  await setLocale(page, baseURL!, "en");
  const documentKey = `STOCK_RECEIVING:STOCK_RECEIVING:${authenticatedE2EIds.receivingReference}`;
  const movementPath = `/inventory/movements/${encodeURIComponent(documentKey)}`;
  await gotoStable(page, movementPath);
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  const tableContainment = await table.evaluate((node) => {
    const container = node.parentElement;
    if (!container) return null;
    const style = getComputedStyle(container);
    return {
      clientWidth: container.clientWidth,
      scrollWidth: container.scrollWidth,
      overflowX: style.overflowX,
      tableWidth: node.scrollWidth,
    };
  });
  expect(tableContainment, "movement table must expose its local scroll container").not.toBeNull();
  expect(["auto", "scroll"]).toContain(tableContainment!.overflowX);
  expect(tableContainment!.scrollWidth).toBeGreaterThan(tableContainment!.clientWidth);
  expect(tableContainment!.tableWidth).toBeGreaterThan(tableContainment!.clientWidth);
  await assertNoRootOverflow(page);

  const documentActions = page.getByRole("button", {
    name: english.inventory.movementJournal.documentActions,
    exact: true,
  });
  await tabUntilFocused(page, documentActions);
  await expectVisibleKeyboardFocus(page);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("menuitem", {
      name: english.inventory.movementJournal.viewDetails,
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expectNoUncontainedHorizontalClipping(page, page.locator("main"));

  const narrowProfile = browserZoomProfiles.narrow;
  profiles.push({
    profile: narrowProfile,
    snapshot: await emulateBrowserZoomReflow(page, narrowProfile),
  });
  const kyrgyz = messagesByLocale.kg;
  await setLocale(page, baseURL!, "kg");
  const posPath = `/pos/sell?registerId=${encodeURIComponent(authenticatedE2EIds.primaryRegister)}`;
  await gotoStable(page, posPath);
  await expect(page.locator("html")).toHaveAttribute("lang", documentLanguageByLocale.kg);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(kyrgyz.pos.entry.sell);
  const addProducts = page.getByRole("button", {
    name: kyrgyz.pos.sell.mobile.addProducts,
    exact: true,
  });
  await tabUntilFocused(page, addProducts);
  await expectVisibleKeyboardFocus(page);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(kyrgyz.pos.sell.mobile.catalog);
  const posSearch = page.getByRole("combobox", {
    name: kyrgyz.pos.sell.mobile.search,
    exact: true,
  });
  await tabUntilFocused(page, posSearch);
  await expectVisibleKeyboardFocus(page);
  await page.keyboard.type("Q");
  await expect(posSearch).toHaveValue("Q");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await expect(posSearch).toHaveValue("");
  await assertVisibleInteractiveControlsNamed(page);
  await assertNoRootOverflow(page);
  await expectNoUncontainedHorizontalClipping(page, page.locator("body"));
  await expectNoClippedInteractiveLabels(page.getByRole("heading", { level: 1 }).locator(".."));
  await expectNoClippedInteractiveLabels(posSearch.locator(".."));
  assertCleanPageAudit(pageAudit);

  await attachReflowEvidence(testInfo, {
    profiles,
    locales: ["en", "kg"],
    routes: [movementPath, posPath],
    assertions: [
      "wide data table contained by an intentional local scroller",
      "keyboard-reachable menu with Enter/Escape operation",
      "POS 320 CSS px keyboard navigation and input",
      "visible focus",
      "root overflow",
      "uncontained control and label clipping",
    ],
  });
});
