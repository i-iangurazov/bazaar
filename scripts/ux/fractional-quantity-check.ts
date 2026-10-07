import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import { expect as baseExpect } from "playwright/test";
const expect = baseExpect.configure({ timeout: 60_000 });

type Api = (name: string, input: unknown, mutation?: boolean) => Promise<any>;
/** Real mobile/desktop quantity input must persist decimals, calculate money and survive reload. */
export async function verifyFractionalQuantities(
  page: Page,
  base: string,
  fixture: { storeId: string },
  api: Api,
  output: string,
) {
  assert.equal(new URL(base).hostname, "localhost", "Quantity fixtures require isolated localhost");
  await mkdir(output, { recursive: true });
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(60_000);
  const unit = await api(
    "units.create",
    { code: `kg-${randomUUID().slice(0, 8)}`, labelRu: "кг", labelKg: "кг", quantityPrecision: 3 },
    true,
  );
  const name = "Гвозди на вес QA";
  const profile = await api("orgSettings.getBusinessProfile", { storeId: fixture.storeId });
  const priceModes = profile.organization.retailWholesaleEnabled
    ? { retailPriceKgs: 400, wholesalePriceKgs: 400 }
    : {};
  const product = await api(
    "products.create",
    {
      storeId: fixture.storeId,
      name,
      idempotencyKey: randomUUID(),
      baseUnitId: unit.id,
      basePriceKgs: 400,
      ...priceModes,
      initialOnHand: 5,
    },
    true,
  );
  const register = await api(
    "pos.registers.create",
    { storeId: fixture.storeId, name: "Весовые товары QA", code: randomUUID().slice(0, 8) },
    true,
  );
  await api(
    "pos.shifts.open",
    { registerId: register.id, openingCashKgs: 0, idempotencyKey: randomUUID() },
    true,
  );
  const sale = await api("pos.sales.createDraft", { registerId: register.id }, true);
  await api("pos.sales.addLine", { saleId: sale.id, productId: product.id, qty: 1 }, true);
  const savedQuantity = async () =>
    (await api("pos.sales.get", { saleId: sale.id })).lines.find(
      (line: { productId: string }) => line.productId === product.id,
    )?.qty;
  const checks: string[] = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/pos/sell?registerId=${register.id}`);
  const input = page.getByTestId("pos-line-qty").filter({ visible: true });
  for (const raw of ["1.5", "0,3", "1,5"]) {
    await expect(input).toBeEnabled();
    await input.fill(raw);
    await input.blur();
    const qty = Number(raw.replace(",", "."));
    await expect(input).toHaveValue(String(qty));
    await expect.poll(savedQuantity).toBe(qty);
    await expect(page.getByTestId("pos-cart-total").filter({ visible: true })).toContainText(
      qty === 0.3 ? "120" : "600",
    );
  }
  await page.screenshot({ path: `${output}/desktop-1.5kg.png` });
  await page.reload();
  await expect(input).toHaveValue("1.5");
  checks.push("Desktop: 1.5 and 1,5 persist as 1.5 kg; 0,3 is 0.3 kg; amounts and reload agree");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const row = page.getByTestId("pos-cart-line").filter({ visible: true }).filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.click();
  const dialog = page.getByRole("dialog", { name, exact: true });
  await expect(dialog).toBeVisible();
  for (const key of ["1", ",", "4"])
    await dialog.getByRole("button", { name: key, exact: true }).click();
  await expect(dialog.getByTestId("pos-line-qty")).toHaveText("1,4");
  await expect.poll(savedQuantity).toBe(1.4);
  await dialog.getByRole("button", { name: "↵", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toContainText("560");
  await page.locator("button").filter({ hasText: "Перейти к оплате" }).click();
  await expect(page.getByTestId("pos-cart-total").filter({ visible: true })).toContainText("560");
  await page.screenshot({ path: `${output}/mobile-1.4kg.png` });
  checks.push("Mobile keypad: comma preserves 1.4 kg and the total is 560 KGS");
  const editor = await page.context().newPage();
  editor.setDefaultNavigationTimeout(60_000);
  for (const width of [1440, 390]) {
    await editor.setViewportSize({ width, height: 1000 });
    for (const path of [
      `/products/new?storeId=${fixture.storeId}`,
      `/products/${product.id}?storeId=${fixture.storeId}`,
    ]) {
      await editor.goto(base + path);
      const selector = editor.getByRole("combobox", { name: "Единица измерения", exact: true });
      await expect(selector).toBeVisible();
      await selector.click();
      await expect(editor.getByRole("option", { name: "кг", exact: true }).last()).toBeVisible();
      await editor.keyboard.press("Escape");
      assert(
        await editor.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        "Unit editor must not overflow",
      );
    }
    await editor.screenshot({ path: `${output}/unit-editor-${width}.png`, fullPage: true });
  }
  await editor.close();
  checks.push("Unit chooser is visible in new/edit product forms at 1440px and 390px");
  return checks;
}
