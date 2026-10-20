import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import { expect as baseExpect } from "playwright/test";

const expect = baseExpect.configure({ timeout: 60_000 });
type Api = (name: string, input: unknown, mutation?: boolean) => Promise<unknown>;
type CountLine = { product: { id: string }; countedQty: number; barcodeValue: string | null };

export async function verifyStockCountSearch(
  page: Page,
  base: string,
  fixture: { storeId: string; unitId: string },
  api: Api,
  output: string,
) {
  assert.equal(new URL(base).hostname, "localhost");
  await mkdir(output, { recursive: true });
  const nonce = randomUUID().slice(0, 8);
  const name = `Терка инвентаризация QA ${nonce}`;
  const barcode = `COUNT-${nonce}`;
  const profile = (await api("orgSettings.getBusinessProfile", { storeId: fixture.storeId })) as {
    organization: { retailWholesaleEnabled: boolean };
  };
  const product = (await api(
    "products.create",
    {
      storeId: fixture.storeId,
      baseUnitId: fixture.unitId,
      name,
      basePriceKgs: 100,
      ...(profile.organization.retailWholesaleEnabled
        ? { retailPriceKgs: 100, wholesalePriceKgs: 90 }
        : {}),
      initialOnHand: 5,
      barcodes: [barcode],
      idempotencyKey: randomUUID(),
    },
    true,
  )) as { id: string };
  const stock = async () => {
    const data = (await api("inventory.list", { storeId: fixture.storeId, search: name })) as {
      items: { product: { id: string }; snapshot: { onHand: number } }[];
    };
    return data.items.find((row) => row.product.id === product.id)?.snapshot.onHand;
  };
  const before = await stock();
  assert.equal(before, 5);
  const checks: string[] = [];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    const count = (await api("stockCounts.create", { storeId: fixture.storeId }, true)) as {
      id: string;
    };
    await page.goto(`${base}/inventory/counts/${count.id}`);
    const search = page.getByRole("combobox", { name: "Название, SKU или штрихкод", exact: true });
    await expect(search).toBeEnabled();
    await search.fill(`инвентаризация QA ${nonce}`);
    const option = page.getByRole("option").filter({ hasText: name });
    await expect(option).toBeVisible();
    await expect(option.getByText(name, { exact: true })).toHaveCSS("white-space", "normal");
    const box = await option.boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= width + 1, "Search menu overflows");
    await page.screenshot({ path: `${output}/name-search-${width}.png` });
    await option.click();
    await expect(search).toHaveValue("");
    const lines = async () =>
      (
        (await api("stockCounts.get", { stockCountId: count.id })) as {
          lines: CountLine[];
        }
      ).lines;
    await expect.poll(async () => (await lines())[0]?.countedQty).toBe(1);
    assert.equal((await lines())[0].product.id, product.id);
    await search.fill(barcode);
    await expect(page.getByRole("option").filter({ hasText: name })).toBeVisible();
    await search.press("Enter");
    await expect(search).toHaveValue("");
    await expect.poll(async () => (await lines())[0]?.countedQty).toBe(2);
    assert.equal((await lines())[0].barcodeValue, barcode);
    assert.equal((await lines()).length, 1);
    assert.equal(await stock(), before, "Draft counting changed real stock");
    await page.screenshot({ path: `${output}/counted-${width}.png` });
    checks.push(
      `${width}px: name selection and barcode increment the same count line; real stock stays unchanged`,
    );
    console.log(`Stock count ${width}px passed`);
  }
  await page.goto(`${base}/products?storeId=${fixture.storeId}`);
  const more = page
    .locator("[data-native-bottom-nav]")
    .getByRole("button", { name: "Ещё", exact: true });
  await more.click();
  const menu = page.getByRole("dialog", { name: "Ещё", exact: true });
  await expect(menu.getByRole("link", { name: "Оприходование", exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Инвентаризация", exact: true })).toBeVisible();
  await page.screenshot({ path: `${output}/mobile-inventory-menu.png` });
  await menu.getByRole("link", { name: "Оприходование", exact: true }).click();
  console.log("Stock count: receiving link clicked");
  await expect(page).toHaveURL(/\/inventory\/receiving/);
  await expect(menu).toBeHidden();
  await expect(page.getByRole("heading", { name: "Оприходование", exact: true }).first()).toBeVisible();
  console.log("Stock count: receiving page ready");
  await more.click();
  await menu.getByRole("link", { name: "Инвентаризация", exact: true }).click();
  await expect(page).toHaveURL(/\/inventory\/counts/);
  await expect(menu).toBeHidden();
  await expect(page.getByRole("heading", { name: "Пересчеты", exact: true })).toBeVisible();
  await page.goto(`${base}/inventory?storeId=${fixture.storeId}`);
  await expect(
    page.locator("[data-page-header]").getByRole("link", { name: "Оприходование", exact: true }),
  ).toBeVisible();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: `${output}/mobile-inventory-actions.png` });
  checks.push("Mobile: More opens Receiving and Stock counts; Inventory actions are visible");
  return checks;
}
