import { readFileSync } from "node:fs";

import type { Page, TestInfo } from "@playwright/test";

import {
  assertNoMixedLanguageMessages,
  assertResponsiveControlBreadth,
  documentLanguageByBreadthLocale,
  type BreadthLocale,
} from "./breadth-assertions";
import {
  assertCleanPageAudit,
  assertNoRootOverflow,
  assertVisibleInteractiveControlsNamed,
  assertVisibleTerminalHeading,
  attachAuditOnFailure,
  expect,
  test,
} from "./test-fixtures";

type KkmCopy = {
  common: { loading: string; tryAgain: string };
  pos: {
    kkm: {
      title: string;
      checkingAccess: string;
      accessCheckFailedTitle: string;
      accessCheckFailedDescription: string;
      planRequiredTitle: string;
      planRequiredAdminDescription: string;
      viewPlans: string;
      storesLoadFailedTitle: string;
      storesLoadFailedDescription: string;
      queueLoadFailedTitle: string;
      queueLoadFailedDescription: string;
      queueTitle: string;
      empty: string;
      store: string;
      status: string;
      generatePairCode: string;
    };
  };
};

const kkmCopyByLocale = Object.fromEntries(
  (["en", "ru", "kg"] as const).map((locale) => [
    locale,
    JSON.parse(
      readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"),
    ) as KkmCopy,
  ]),
) as Record<BreadthLocale, KkmCopy>;

const terminalKkmState = async (page: Page, copy: KkmCopy) => {
  await expect(page.getByText(copy.pos.kkm.checkingAccess, { exact: true })).toHaveCount(0);
  await expect(page.getByText(copy.common.loading, { exact: true })).toHaveCount(0);

  const dependencyError = page.getByRole("main").getByRole("alert");
  const planRequired = page.getByText(copy.pos.kkm.planRequiredTitle, { exact: true });
  const queue = page.getByText(copy.pos.kkm.queueTitle, { exact: true });
  await expect
    .poll(
      async () =>
        (await dependencyError.count()) + (await planRequired.count()) + (await queue.count()),
    )
    .toBeGreaterThan(0);

  if (await dependencyError.isVisible().catch(() => false)) return "recoverable-error" as const;
  if (await planRequired.isVisible().catch(() => false)) return "plan-guidance" as const;
  return "usable-queue" as const;
};

test.afterEach(async ({ pageAudit }, testInfo: TestInfo) => {
  await attachAuditOnFailure(testInfo, pageAudit);
});

for (const profile of [
  { name: "desktop", width: 1440, height: 900, locale: "en" },
  { name: "tablet", width: 1024, height: 768, locale: "ru" },
  { name: "mobile", width: 390, height: 844, locale: "kg" },
] as const) {
  test(`BZR-REQ-0048 KKM reaches a localized terminal state at ${profile.name}`, async ({
    page,
    pageAudit,
    baseURL,
  }, testInfo) => {
    expect(baseURL).toBeTruthy();
    const copy = kkmCopyByLocale[profile.locale];
    await page.setViewportSize({ width: profile.width, height: profile.height });
    await page
      .context()
      .addCookies([{ name: "NEXT_LOCALE", value: profile.locale, url: baseURL! }]);

    const response = await page.goto("/pos/kkm", { waitUntil: "domcontentloaded" });
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(500);
    await assertVisibleTerminalHeading(page);
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      documentLanguageByBreadthLocale[profile.locale],
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.pos.kkm.title);

    let terminalState = await terminalKkmState(page, copy);
    if (terminalState === "recoverable-error") {
      const alert = page.getByRole("main").getByRole("alert");
      const alertText = await alert.innerText();
      const expectedErrors = [
        [copy.pos.kkm.accessCheckFailedTitle, copy.pos.kkm.accessCheckFailedDescription],
        [copy.pos.kkm.storesLoadFailedTitle, copy.pos.kkm.storesLoadFailedDescription],
        [copy.pos.kkm.queueLoadFailedTitle, copy.pos.kkm.queueLoadFailedDescription],
      ] as const;
      expect(
        expectedErrors.some(
          ([title, description]) => alertText.includes(title) && alertText.includes(description),
        ),
        `unexpected KKM recovery copy: ${alertText}`,
      ).toBe(true);

      const retry = alert.getByRole("button", { name: copy.common.tryAgain, exact: true });
      await expect(retry).toBeEnabled();
      await retry.click();
      terminalState = await terminalKkmState(page, copy);
    } else if (terminalState === "plan-guidance") {
      await expect(
        page.getByText(copy.pos.kkm.planRequiredAdminDescription, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: copy.pos.kkm.viewPlans, exact: true }),
      ).toHaveAttribute("href", "/billing");
    } else {
      await expect(
        page.getByRole("combobox", { name: copy.pos.kkm.store, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: copy.pos.kkm.status, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: copy.pos.kkm.generatePairCode, exact: true }),
      ).toBeDisabled();
      const queueContent = page.getByText(copy.pos.kkm.empty, { exact: true });
      const queueRows = page.locator("main [data-kkm-receipt]");
      await expect
        .poll(async () => (await queueContent.count()) + (await queueRows.count()))
        .toBeGreaterThan(0);
    }

    await assertNoRootOverflow(page);
    await assertVisibleInteractiveControlsNamed(page);
    await assertNoMixedLanguageMessages(page, profile.locale);
    await assertResponsiveControlBreadth(page);
    assertCleanPageAudit(pageAudit);

    await testInfo.attach("bzr-req-0048-kkm-terminal-state", {
      body: JSON.stringify(
        {
          requirement: "BZR-REQ-0048",
          route: "/pos/kkm",
          profile,
          terminalState,
          assertions: [
            "loading state withdrawn",
            "localized dependency-specific terminal copy",
            "retry or upgrade guidance is operable",
            "no root or interactive-control clipping",
            "no mixed-language message fingerprints",
            "no side effects or external traffic",
          ],
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  });
}
