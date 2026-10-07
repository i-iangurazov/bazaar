import assert from "node:assert/strict";
import type { Page } from "playwright";
import { expect } from "playwright/test";

type Receipt = {
  id: string;
  number: string;
  lines: { qty: number; unitPriceKgs: number }[];
  totalKgs: number;
  payments: { amountKgs: number; isRefund: boolean }[];
};

export async function verifyPosReceiptEditing(
  page: Page,
  base: string,
  registerId: string,
  getReceipt: () => Promise<Receipt>,
) {
  const before = await getReceipt();
  assert.equal(before.lines.length, 1);
  const save = () =>
    page
      .getByRole("button", { name: "Сохранить исправление", exact: true })
      .filter({ visible: true });
  const assertEditor = async () => {
    await expect(save()).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByTestId("pos-line-qty").filter({ visible: true })).toHaveValue(
      String(before.lines[0]!.qty),
    );
  };
  await page.goto(`${base}/pos/history?registerId=${encodeURIComponent(registerId)}`);
  await page
    .getByRole("button", { name: "Редактировать", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`receiptId=${before.id}&mode=edit`));
  await assertEditor();
  // Refresh must hydrate the same completed receipt into the editor.
  await page.reload();
  await assertEditor();
  const price = page
    .getByRole("textbox", { name: "Цена", exact: true })
    .filter({ visible: true })
    .first();
  const nextPrice = before.lines[0]!.unitPriceKgs + 1;
  await price.fill(String(nextPrice));
  await price.blur();
  await save().click();
  await expect(page.getByText("Чек сохранен.", { exact: true })).toBeVisible();
  const after = await getReceipt();
  assert.equal(after.id, before.id);
  assert.equal(after.lines[0]!.unitPriceKgs, nextPrice);
  assert.equal(after.lines[0]!.qty, before.lines[0]!.qty);
  assert.equal(after.totalKgs, before.totalKgs + before.lines[0]!.qty);
  assert.equal(
    after.payments.filter((p) => !p.isRefund).reduce((s, p) => s + p.amountKgs, 0),
    after.totalKgs,
  );

  await page.goto(`${base}/pos/sell?registerId=${encodeURIComponent(registerId)}`);
  await page.getByRole("button", { name: "Журнал чеков", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: before.number })
    .getByTestId("pos-receipt-journal-edit-button")
    .click();
  await assertEditor();
  await expect(price).toHaveValue(String(nextPrice));

  // Closing the discount editor must preserve local corrections until Save.
  if (after.totalKgs > 0) {
    const discount = Math.min(1, after.totalKgs);
    await page.getByRole("button", { name: "Добавить скидку", exact: false }).click();
    await page.getByLabel("Скидка на чек", { exact: true }).fill(String(discount));
    await page.getByRole("button", { name: "Применить скидку", exact: true }).click();
    await page.getByRole("button", { name: /^Скидка / }).click();
    const amount = page.getByTestId("pos-payment-row").getByLabel("Сумма", { exact: true });
    await expect(amount).toHaveValue(String(Math.round((after.totalKgs - discount) * 100) / 100));
    assert.equal((await getReceipt()).totalKgs, after.totalKgs);
    await page.getByRole("button", { name: "Убрать скидку", exact: true }).click();
    await expect(amount).toHaveValue(String(after.totalKgs));
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/pos/history?registerId=${encodeURIComponent(registerId)}`);
  await page
    .getByRole("button", { name: "Редактировать", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  // Wait for the receipt to hydrate before navigating to its payment tab.
  await page.getByRole("button", { name: "Открыть чек", exact: true }).click();
  await expect(save()).toBeEnabled({ timeout: 30_000 });
  await page.setViewportSize({ width: 1440, height: 1000 });
}
