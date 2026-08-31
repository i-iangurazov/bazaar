import { readFileSync } from "node:fs";

import type { Locator, Page, TestInfo } from "@playwright/test";

import {
  assertCleanPageAudit,
  assertMeaningfulPrimaryHeading,
  assertNoRawTranslationArtifacts,
  assertNoRootOverflow,
  assertVisibleInteractiveControlsNamed,
  assertVisibleTerminalHeading,
  attachAuditOnFailure,
  expect,
  test,
} from "./test-fixtures";

type SupportedLocale = "en" | "kg" | "ru";

type EmailWorkspaceCopy = {
  title: string;
  subtitle: string;
  actions: { createCampaign: string };
  builder: { unavailableTitle: string; unavailableMessage: string };
  tabs: Record<"campaigns" | "automations" | "senders" | "templates", string>;
};

const emailWorkspaceCopy = Object.fromEntries(
  (["en", "kg", "ru"] as const).map((locale) => [
    locale,
    (
      JSON.parse(
        readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"),
      ) as { emailMarketingWorkspace: EmailWorkspaceCopy }
    ).emailMarketingWorkspace,
  ]),
) as Record<SupportedLocale, EmailWorkspaceCopy>;

const tabUntilFocused = async (page: Page, target: Locator, maximumTabs = 60) => {
  for (let index = 0; index < maximumTabs; index += 1) {
    await page.keyboard.press("Tab");
    if (
      await target.evaluateAll((elements) =>
        elements.some((element) => element === document.activeElement),
      )
    )
      return;
  }
  throw new Error(`Keyboard focus did not reach the requested control after ${maximumTabs} tabs.`);
};

const expectVisibleKeyboardFocus = async (page: Page) => {
  const indicator = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const style = getComputedStyle(active);
    return {
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  expect(indicator, "a focusable HTMLElement must own keyboard focus").not.toBeNull();
  const outlined =
    indicator?.outlineStyle !== "none" && Number.parseFloat(indicator?.outlineWidth ?? "0") > 0;
  const ringed = Boolean(indicator?.boxShadow && indicator.boxShadow !== "none");
  expect(outlined || ringed, `focus indicator: ${JSON.stringify(indicator)}`).toBe(true);
};

const gotoStable = async (page: Page, path: string) => {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `${path} must return a document`).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);
  await assertVisibleTerminalHeading(page);
  await assertNoRootOverflow(page);
};

test.afterEach(async ({ pageAudit }, testInfo: TestInfo) => {
  await attachAuditOnFailure(testInfo, pageAudit);
});

test("keyboard navigation exposes visible focus and activates application navigation", async ({
  page,
  pageAudit,
}) => {
  await gotoStable(page, "/dashboard");
  const productsLink = page.getByRole("link", { name: "Products", exact: true });
  await tabUntilFocused(page, productsLink);
  await expectVisibleKeyboardFocus(page);
  await page.keyboard.press("Enter");
  await expect.poll(() => new URL(page.url()).pathname).toBe("/products");
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  assertCleanPageAudit(pageAudit);
});

test("customer modal traps keyboard focus, restores it, and exposes field errors semantically", async ({
  page,
  pageAudit,
}) => {
  await gotoStable(page, "/customers");
  const addCustomer = page.getByRole("button", { name: "Add Customer", exact: true });
  await expect(addCustomer).toBeEnabled();
  await tabUntilFocused(page, addCustomer);
  await expectVisibleKeyboardFocus(page);
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Add customer" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName("Add customer");
  await expect
    .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);

  for (let index = 0; index < 16; index += 1) {
    await page.keyboard.press("Tab");
    await expect
      .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
      .toBe(true);
  }

  const name = dialog.getByRole("textbox", { name: "Name", exact: true });
  const email = dialog.getByRole("textbox", { name: "Email", exact: true });
  const phone = dialog.getByRole("textbox", { name: "Phone", exact: true });
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAttribute("aria-describedby", "customer-name-error");
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveAttribute("aria-describedby", "customer-contact-error");
  await expect(phone).toHaveAttribute("aria-invalid", "true");
  await expect(phone).toHaveAttribute("aria-describedby", /customer-contact-error/);
  const alert = dialog.getByRole("alert");
  await expect(alert).toHaveAttribute("aria-live", "assertive");
  await expect(alert).toContainText("Name is required.");
  await expect(alert).toContainText("Enter at least an email or phone.");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect
    .poll(() =>
      addCustomer.evaluateAll((nodes) => nodes.some((node) => node === document.activeElement)),
    )
    .toBe(true);
  await expectVisibleKeyboardFocus(page);
  assertCleanPageAudit(pageAudit);
});

const representativeFormRoutes = [
  ["product creation", "/products/new"],
  ["stock receiving", "/inventory/receiving"],
  ["sales-order creation", "/sales/orders/new"],
  ["reports", "/reports"],
  ["profile settings", "/settings/profile"],
] as const;

for (const [name, path] of representativeFormRoutes) {
  test(`representative ${name} controls expose accessible names`, async ({ page, pageAudit }) => {
    await gotoStable(page, path);
    const controls = page.locator(
      "main button:visible, main a[href]:visible, main input:visible, main textarea:visible, main [role='combobox']:visible",
    );
    const count = await controls.count();
    expect(count, `${path} must expose interactive controls`).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      await expect(
        controls.nth(index),
        `${path} control ${index + 1}/${count}`,
      ).toHaveAccessibleName(/\S/);
    }
    assertCleanPageAudit(pageAudit);
  });
}

test("email-marketing workspace renders complete EN/RU/KG copy without provider side effects", async ({
  page,
  pageAudit,
  baseURL,
}) => {
  expect(baseURL).toBeTruthy();
  const langByLocale: Record<SupportedLocale, string> = {
    en: "en-US",
    kg: "ky-KG",
    ru: "ru",
  };

  for (const locale of ["en", "kg", "ru"] as const) {
    const copy = emailWorkspaceCopy[locale];
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL! }]);
    await gotoStable(page, "/operations/integrations/email-marketing");

    const workspace = page.locator('[data-email-marketing-workspace="overview"]');
    await expect(workspace).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", langByLocale[locale]);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.title);
    await expect(workspace).toContainText(copy.subtitle);
    await expect(
      workspace.getByRole("button", { name: copy.actions.createCampaign, exact: true }).first(),
    ).toBeVisible();
    for (const tab of Object.values(copy.tabs)) {
      await expect(workspace.getByRole("tab", { name: tab, exact: true })).toBeVisible();
    }
    await assertMeaningfulPrimaryHeading(page);
    await assertVisibleInteractiveControlsNamed(page);
    await assertNoRawTranslationArtifacts(page);

    if (locale !== "ru") {
      for (const formerRussianOnlyCopy of [
        "Создать кампанию",
        "Кампании",
        "Автоматизации",
        "Отправители",
        "Редактор писем доступен только на компьютере",
      ]) {
        await expect(workspace.getByText(formerRussianOnlyCopy, { exact: true })).toHaveCount(0);
      }
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await assertVisibleTerminalHeading(page);
    await expect(page.locator("html")).toHaveAttribute("lang", langByLocale[locale]);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.title);
  }

  assertCleanPageAudit(pageAudit);
});

test("Kyrgyz email-marketing long labels remain unclipped at 390px", async ({
  page,
  pageAudit,
  baseURL,
}) => {
  expect(baseURL).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "kg", url: baseURL! }]);
  await gotoStable(page, "/operations/integrations/email-marketing");

  const workspace = page.locator('[data-email-marketing-workspace="overview"]');
  await expect(workspace).toContainText(emailWorkspaceCopy.kg.builder.unavailableTitle);
  await expect(workspace).toContainText(emailWorkspaceCopy.kg.builder.unavailableMessage);
  await assertVisibleInteractiveControlsNamed(page);
  await expect
    .poll(() =>
      workspace.evaluate((root) => {
        const interactive = Array.from(
          root.querySelectorAll<HTMLElement>(
            "button, a[href], input:not([type='hidden']), textarea, select, [role='button'], [role='combobox']",
          ),
        ).filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
        });
        const hasHorizontalScroller = (element: HTMLElement) => {
          for (
            let parent = element.parentElement;
            parent && parent !== root;
            parent = parent.parentElement
          ) {
            const style = getComputedStyle(parent);
            if (
              parent.scrollWidth > parent.clientWidth + 1 &&
              (style.overflowX === "auto" || style.overflowX === "scroll")
            ) {
              return true;
            }
          }
          return false;
        };
        return interactive
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            const clipped = rect.left < -1 || rect.right > window.innerWidth + 1;
            return clipped && !hasHorizontalScroller(element);
          })
          .map(
            (element) =>
              element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName,
          );
      }),
    )
    .toEqual([]);
  assertCleanPageAudit(pageAudit);
});
