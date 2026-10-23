import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import { expect as baseExpect } from "playwright/test";

const expect = baseExpect.configure({ timeout: 60_000 });
type Api = (name: string, input: unknown, mutation?: boolean) => Promise<unknown>;

export async function verifyImportConnections(
  page: Page,
  base: string,
  fixture: { storeId: string; emptyStoreId: string; unitId: string },
  api: Api,
  output: string,
) {
  assert.equal(new URL(base).hostname, "localhost");
  await mkdir(output, { recursive: true });
  const stores = (await api("stores.list", undefined)) as { id: string; name: string }[];
  const target = stores.find((store) => store.id === fixture.emptyStoreId);
  assert(target);
  const units = (await api("units.list", undefined)) as { id: string; code: string }[];
  const unit = units.find((candidate) => candidate.id === fixture.unitId);
  assert(unit);
  const nonce = randomUUID().slice(0, 8);
  const sourceRows = Array.from({ length: 59 }, (_, index) => ({
    sku: `CONNECT-${nonce}-${index}`,
    name: `Исходная карточка импорта ${nonce} ${index}`,
    unit: unit.code,
    basePriceKgs: 100,
    avgCostKgs: 70,
    stockQty: 10,
  }));
  await api(
    "products.importCsv",
    {
      storeId: fixture.storeId,
      rows: sourceRows,
      stockBehavior: "set",
      idempotencyKey: randomUUID(),
    },
    true,
  );
  const ids = (await api("products.listIds", {
    storeId: fixture.storeId,
    search: `CONNECT-${nonce}`,
  })) as string[];
  assert.equal(ids.length, 59);
  const products = (await api("products.byIds", { ids })) as {
    id: string;
    sku: string;
    name: string;
    unit: string;
  }[];
  await api("products.archive", { productId: products[1].id }, true);
  const csv = [
    "SKU,Название,Ед. измерения,Цена продажи,Себестоимость,Минимальный остаток,Остаток",
    ...products.map((product) => `${product.sku},Название из файла,${unit.code},225,1,7,5`),
  ].join("\n");
  const checks: string[] = [];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width > 768 ? 1000 : 844 });
    await page.goto(`${base}/settings/import`);
    await page.getByRole("combobox", { name: "Магазин для импорта", exact: true }).click();
    await page.getByRole("option", { name: target.name, exact: true }).click();
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "products.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      });
    const connect = page.getByRole("button", { name: "Добавить показанные (59)", exact: true });
    await expect(connect).toBeEnabled();
    await expect(
      page.getByText(
        "Восстановление архивного товара действует во всех магазинах, где он подключён.",
        { exact: true },
      ),
    ).toBeVisible();
    const previewCard = connect.locator("..");
    await previewCard.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/review-${width}.png` });
    await connect.click();
    await expect(page.getByText("Будет добавлено в магазин: 59", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Применить импорт", exact: true })).toBeEnabled();
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      "Import UI overflows",
    );
    await page.getByText("Будет добавлено в магазин: 59", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/confirmed-${width}.png` });
    checks.push(
      `${width}px: import reviews actual cards and explicitly connects active/archived products`,
    );
  }
  // A temporary preview failure is recoverable without re-uploading the file.
  await page.route("**/api/trpc/products.previewImportCsv*", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify([
        {
          error: {
            json: {
              message: "productsImportFailed",
              code: -32603,
              data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
            },
          },
        },
      ]),
    });
  });
  const refresh = page.getByRole("button", { name: "Обновить проверку", exact: true });
  await refresh.click();
  await expect(page.getByText("Будет добавлено в магазин: 59", { exact: true })).toBeHidden();
  await expect(refresh).toBeEnabled();
  await page.unroute("**/api/trpc/products.previewImportCsv*");
  await refresh.click();
  await expect(page.getByText("Будет добавлено в магазин: 59", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Применить импорт", exact: true }).click();
  await expect(page.getByText("Добавлено в магазин: 59", { exact: true }).first()).toBeVisible();
  const current = (await api("products.byIds", { ids })) as {
    id: string;
    name: string;
    sku: string;
    isDeleted: boolean;
  }[];
  assert.equal(current.length, 59);
  for (const product of products) {
    const same = current.find((item) => item.id === product.id);
    assert.equal(same?.name, product.name);
    assert.equal(same?.sku, product.sku);
    assert.equal(same?.isDeleted, false);
  }
  for (const [storeId, quantity] of [
    [fixture.storeId, 10],
    [fixture.emptyStoreId, 5],
  ] as const) {
    const inventory = (await api("inventory.list", {
      storeId,
      search: `CONNECT-${nonce}`,
      pageSize: 200,
    })) as {
      items: { product: { id: string }; snapshot: { onHand: number } }[];
    };
    assert.equal(inventory.items.length, 59);
    for (const item of inventory.items) assert.equal(item.snapshot.onHand, quantity);
  }
  checks.push(
    "Import: preview retry recovers; 59 existing cards connect in one action without duplicates or source-stock changes",
  );
  return checks;
}
