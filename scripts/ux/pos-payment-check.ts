import assert from "node:assert/strict";
import type { Page } from "playwright";
import { expect } from "playwright/test";

export async function verifyPosPaymentChoices(page: Page) {
  const selector = page
    .getByRole("combobox", { name: "Способ оплаты", exact: true })
    .filter({ visible: true })
    .first();
  await expect(selector).toBeVisible();
  await selector.click();
  await expect(page.getByRole("option", { name: "Безналичные", exact: true })).toBeVisible();
  assert.deepEqual(await page.getByRole("option").allTextContents(), ["Наличные", "Безналичные"]);
  await page.getByRole("option", { name: "Безналичные", exact: true }).click();
  await expect(selector).toHaveText("Безналичные");
}
