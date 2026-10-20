import assert from "node:assert/strict";
import type { Page } from "playwright";
import { expect } from "playwright/test";
import { verifyPosSearchSelection } from "./pos-search-selection-check";

export async function verifyPosCatalogImages(page: Page) {
  const products = page.getByTestId("pos-product-button").filter({ visible: true });
  await expect(products.first()).toBeVisible({ timeout: 60_000 });
  for (const product of (await products.all()).slice(0, 8)) {
    const image = await product.locator("[data-pos-product-image]").boundingBox();
    const name = await product.locator("[data-pos-product-name]").boundingBox();
    const row = await product.boundingBox();
    assert.ok(image && name && row);
    assert.ok(image.width >= 56 && image.height >= 56, "Product photos must be legible");
    assert.ok(Math.abs(image.width - image.height) < 1, "Photo frames must stay square");
    assert.ok(image.x + image.width <= name.x, "The photo overlaps the product name");
    assert.ok(image.y >= row.y && image.y + image.height <= row.y + row.height + 1);
    assert.ok(row.x + row.width <= page.viewportSize()!.width + 1, "Product row overflows");
    const photo = product.locator("[data-pos-product-image] img");
    if (await photo.count()) {
      await expect(photo).toHaveCSS("object-fit", "contain");
      const picture = await photo.boundingBox();
      assert.ok(picture && picture.width <= image.width && picture.height <= image.height,
        "The image must fit inside its frame without clipping");
    }
  }
}

export async function verifyPosCheckoutLayout(page: Page, directory: string) {
  const originalViewport = page.viewportSize();
  await verifyPosSearchSelection(page);
  await expect(page.getByRole("button", { name: "Очистить поиск", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Очистить поиск", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Сканировать камерой", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("pos-cart-line")).toHaveCount(1);

  const paymentAmount = page.getByTestId("pos-payment-row").getByLabel("Сумма", { exact: true });
  const originalAmount = await paymentAmount.inputValue();
  const amount = Number(originalAmount);
  if (amount > 0) {
    const discount = Math.max(0.01, Math.round(amount * 10) / 100);
    await page.getByRole("button", { name: "Добавить скидку", exact: false }).click();
    const input = page.getByLabel("Скидка на чек", { exact: true });
    await input.fill(String(discount));
    await page.getByRole("button", { name: "Применить скидку", exact: true }).click();
    await expect(paymentAmount).toHaveValue(String(Math.round((amount - discount) * 100) / 100));
    // A focused unsaved value must not race the explicit remove action through onBlur.
    await input.fill(String(amount));
    await page.getByRole("button", { name: "Убрать скидку", exact: true }).click();
    await expect(paymentAmount).toHaveValue(originalAmount);
    await expect(input).toBeHidden();
  }

  for (const size of [
    { width: 1024, height: 768 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    await verifyPosCatalogImages(page);
    const cart = page.getByTestId("pos-cart-line").first();
    await expect(cart).toBeVisible();
    const hold = await page
      .getByRole("button", { name: "Отложить чек", exact: true })
      .boundingBox();
    const complete = await page
      .getByRole("button", { name: "Завершить продажу", exact: true })
      .boundingBox();
    assert.ok(hold && complete);
    assert.ok(Math.abs(hold.y - complete.y) < 2, "Checkout actions must share one row");
    assert.ok(
      Math.abs(hold.width - complete.width) < 2,
      "Checkout actions must share the available width",
    );
    assert.ok(
      complete.y + complete.height <= size.height + 1,
      "Checkout action is below the viewport",
    );
    for (const control of [
      cart.getByTestId("pos-line-qty"),
      cart.getByTestId("pos-line-price"),
      cart.getByRole("button", { name: "Увеличить количество", exact: true }),
    ]) {
      const box = await control.boundingBox();
      assert.ok(box && box.height >= 24, "Compact cart control is too small");
    }
    await page.screenshot({ path: `${directory}/pos-compact-checkout-${size.width}.png` });
  }

  // Split payments expose the same two choices on every row and preserve the first choice.
  const first = page.getByTestId("pos-payment-row").first();
  await first.getByRole("button", { name: "Безналичные", exact: true }).click();
  await page.getByRole("button", { name: "Добавить оплату", exact: true }).click();
  const rows = page.getByTestId("pos-payment-row");
  await expect(rows).toHaveCount(2);
  await expect(
    rows.first().getByRole("button", { name: "Безналичные", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await rows.nth(1).getByRole("button", { name: "Наличные", exact: true }).click();
  await expect(rows.nth(1).getByRole("button", { name: "Наличные", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await rows.nth(1).getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(rows).toHaveCount(1);
  if (originalViewport) await page.setViewportSize(originalViewport);
}
