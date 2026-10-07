import assert from "node:assert/strict";
import type { Page } from "playwright";
import { expect } from "playwright/test";

export async function verifyPosPaymentChoices(page: Page) {
  const selector = page
    .getByRole("group", { name: "Способ оплаты", exact: true })
    .filter({ visible: true })
    .first();
  await expect(selector).toBeVisible();
  const choices = selector.getByRole("button");
  assert.deepEqual(await choices.allTextContents(), ["Наличные", "Безналичные"]);
  await selector.getByRole("button", { name: "Безналичные", exact: true }).click();
  await expect(selector.getByRole("button", { name: "Безналичные", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(selector.getByRole("button", { name: "Наличные", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
}
