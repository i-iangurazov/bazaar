import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import { expect as baseExpect } from "playwright/test";

const expect = baseExpect.configure({ timeout: 60_000 });
type Api = (name: string, input: unknown, mutation?: boolean) => Promise<any>;

export async function verifyStoreVisibilityAndTransfer(
  page: Page,
  base: string,
  fixture: { unitId: string },
  api: Api,
  output: string,
) {
  assert.equal(
    new URL(base).hostname,
    "localhost",
    "Inventory fixtures require isolated localhost",
  );
  await mkdir(output, { recursive: true });
  const nonce = randomUUID().slice(0, 8);
  const stores = [];
  for (const name of ["Источник", "Склад"])
    stores.push(
      await api(
        "stores.create",
        {
          name: `${name} QA ${nonce}`,
          code: `${name === "Склад" ? "WH" : "SRC"}-${nonce}`,
          allowNegativeStock: false,
          trackExpiryLots: false,
        },
        true,
      ),
    );
  const [source, target] = stores;
  const name = `Переходник 110×50 серый · проверка ${nonce}`;
  const sku = `SHARED-${nonce}`;
  const product = await api(
    "products.create",
    {
      name,
      sku,
      storeId: source.id,
      baseUnitId: fixture.unitId,
      basePriceKgs: 100,
      avgCostKgs: 20,
      initialOnHand: 10,
      idempotencyKey: randomUUID(),
    },
    true,
  );
  const duplicate = await api(
    "products.create",
    {
      name,
      sku: `OTHER-${nonce}`,
      storeId: target.id,
      baseUnitId: fixture.unitId,
      basePriceKgs: 120,
      idempotencyKey: randomUUID(),
    },
    true,
  );
  const settings = (await api("stores.catalogSettings", { storeId: target.id })).settings;
  settings.connections = [
    ...settings.connections.filter(
      (connection: { key: string }) => connection.key !== `store:${source.id}`,
    ),
    { key: `store:${source.id}`, enabled: true, scope: "ALL", productIds: [] },
  ];
  const preview = await api("stores.previewCatalogSettings", settings, true);
  await api(
    "stores.saveCatalogSettings",
    { change: settings, token: preview.token, idempotencyKey: randomUUID() },
    true,
  );
  await api(
    "inventory.receive",
    {
      storeId: target.id,
      productId: product.id,
      qtyReceived: 3,
      unitCost: 20,
      idempotencyKey: randomUUID(),
    },
    true,
  );
  const list = (storeId: string, extra = {}) =>
    api("products.list", { storeId, search: sku, ...extra });
  const checks: string[] = [];
  const browser = page.context().browser();
  assert(browser);
  const touch = await browser.newContext({
    storageState: await page.context().storageState(),
    hasTouch: true,
    ignoreHTTPSErrors: true,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  await touch.route("**/*", (route) =>
    new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
  );
  const touchPage = await touch.newPage();
  const touchErrors: string[] = [];
  touchPage.on("pageerror", (error) => touchErrors.push(error.message));
  try {
    for (const width of [1440, 1024, 390]) {
      const current = width === 1440 ? page : touchPage;
      await current.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await current.goto(
        `${base}/products?storeId=${target.id}&q=${sku}&view=table&archived=false`,
      );
      await expect(
        current.getByText(name, { exact: true }).filter({ visible: true }),
      ).toBeVisible();
      await current.getByRole("button", { name: "Больше действий", exact: true }).last().click();
      await expect(
        current.getByRole("menuitem", { name: "Архивировать во всех магазинах", exact: true }),
      ).toBeVisible();
      await current.getByRole("menuitem", { name: "Скрыть в этом магазине", exact: true }).click();
      const dialog = current.getByRole("dialog", { name: "Подтвердить", exact: true });
      await expect(dialog).toContainText(target.name);
      await expect(dialog).toContainText("В других магазинах товары останутся доступны.");
      await dialog.getByRole("button", { name: "Подтвердить", exact: true }).click();
      await expect(current.getByText(name, { exact: true })).toHaveCount(0);
      assert.equal((await list(source.id)).items[0].onHandQty, 10);
      const hidden = (await list(target.id, { includeArchived: true })).items[0];
      assert.equal(hidden.isDeleted, false);
      assert.equal(hidden.hiddenInStore, true);
      assert.equal(hidden.onHandQty, 3);
      await current.getByRole("button", { name: /Ещё фильтры/ }).click();
      await current
        .getByRole("switch", { name: "Показывать архив и скрытые", exact: true })
        .click();
      await expect(
        current.getByText("Скрыт в этом магазине", { exact: true }).filter({ visible: true }),
      ).toBeVisible();
      await current.screenshot({ path: `${output}/hidden-${width}.png`, fullPage: true });
      await current.getByRole("button", { name: "Вернуть в этот магазин", exact: true }).click();
      await dialog.getByRole("button", { name: "Подтвердить", exact: true }).click();
      await expect(
        current.getByRole("button", { name: "Вернуть в этот магазин", exact: true }),
      ).toHaveCount(0);
      assert.equal((await list(target.id)).items[0].hiddenInStore, false);
      assert.equal(
        (await api("products.list", { storeId: target.id, search: `OTHER-${nonce}` })).items[0].id,
        duplicate.id,
      );
      assert(await current.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      checks.push(
        `Store-local hide/restore ${width}px: explicit scope, unchanged stock, shared original and separate duplicate preserved`,
      );
    }

    // Select the whole filtered result, including rows beyond the first page.
    const units = await api("units.list", undefined);
    const unit = units.find((u: { id: string }) => u.id === fixture.unitId);
    assert(unit);
    const bulkName = `Массовое скрытие ${nonce}`;
    await api(
      "products.importCsv",
      {
        storeId: source.id,
        idempotencyKey: randomUUID(),
        rows: Array.from({ length: 59 }, (_, index) => ({
          name: `${bulkName} ${index}`,
          sku: `BULK-${nonce}-${index}`,
          unit: unit.code,
          basePriceKgs: 100,
        })),
      },
      true,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(
      `${base}/products?storeId=${target.id}&q=${encodeURIComponent(bulkName)}&view=table&pageSize=25&archived=false`,
    );
    await page
      .getByRole("checkbox", { name: "Выбрать записи на этой странице", exact: true })
      .check();
    await page.getByRole("button", { name: "Выбрать все записи (59)", exact: true }).click();
    await page
      .locator('[data-component="selection-toolbar"]')
      .getByRole("button", { name: "Больше действий", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Скрыть в этом магазине", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Подтвердить", exact: true });
    await expect(dialog).toContainText("(59)");
    await dialog.getByRole("button", { name: "Подтвердить", exact: true }).click();
    await expect
      .poll(
        async () => (await api("products.list", { storeId: target.id, search: bulkName })).total,
      )
      .toBe(0);
    assert.equal((await api("products.list", { storeId: source.id, search: bulkName })).total, 59);
    await page.screenshot({ path: `${output}/bulk-59.png`, fullPage: true });
    checks.push(
      "59 shared products hidden across pages in one action, source assortment preserved",
    );

    // Simulate a response lost after commit on desktop and a touch phone.
    for (const width of [1440, 390]) {
      const current = width === 1440 ? page : touchPage;
      await current.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await current.goto(
        `${base}/inventory/transfers?fromStoreId=${source.id}&toStoreId=${target.id}`,
      );
      await current
        .getByRole("searchbox", { name: "Найти товар в источнике", exact: true })
        .fill(name);
      await current.locator(".bazaar-doc-search-row > button").filter({ hasText: name }).click();
      const quantity = current
        .locator('[data-transfer-input="quantity"]')
        .filter({ visible: true });
      await quantity.fill("2");
      const layout = await current.evaluate(() => ({
        width: innerWidth,
        panels: [...document.querySelectorAll(".bazaar-doc-surface")].map(
          (panel) => panel.getBoundingClientRect().width,
        ),
        shifted: [...document.querySelectorAll("main div")].some(
          (element) => element.scrollLeft > 0,
        ),
      }));
      assert(
        layout.panels.every((width) => width <= layout.width),
        "Transfer panels must fit the viewport",
      );
      assert.equal(layout.shifted, false, "Quantity focus must not shift the form sideways");
      const keys: string[] = [];
      let committed: any;
      // Only the posting endpoint: transferLineContext is read-only validation.
      await current.route("**/api/trpc/inventory.transfer?*", async (route) => {
        const raw = route.request().postDataJSON();
        const input = raw.json ?? raw["0"]?.json;
        keys.push(input.idempotencyKey);
        if (keys.length === 1) {
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          const result = await response.json();
          committed = (Array.isArray(result) ? result[0] : result).result.data.json;
          await route.abort("connectionfailed");
        } else await route.continue();
      });
      const post = current.getByRole("button", { name: /^Провести( перемещение)?$/ });
      await post.click();
      await expect.poll(() => Boolean(committed)).toBe(true);
      await expect(post).toBeEnabled();
      await expect(
        current
          .getByRole("alert")
          .filter({ visible: true, hasText: "Повторите отправку без изменений" }),
      ).toContainText("Повторите отправку без изменений");
      await expect(quantity).toHaveValue("2");
      await expect(quantity).toBeDisabled();
      await expect(post).toBeVisible();
      await current.screenshot({ path: `${output}/transfer-error-${width}.png`, fullPage: true });
      await post.click();
      await expect(current).toHaveURL(/\/inventory\/movements\//);
      assert.equal(keys.length, 2);
      assert.equal(keys[0], keys[1]);
      assert.equal((await list(source.id)).items[0].onHandQty, width === 1440 ? 8 : 6);
      assert.equal((await list(target.id)).items[0].onHandQty, width === 1440 ? 5 : 7);
      const movementDocument = await api("inventory.productMovementDocument", {
        documentKey: `TRANSFER:TRANSFER:${committed.transferId}`,
      });
      assert.equal(movementDocument.positionsCount, 1);
      assert.equal(movementDocument.totalQuantity, 2);
      await current.screenshot({ path: `${output}/transfer-retry-${width}.png`, fullPage: true });
      checks.push(
        `Transfer retry ${width}px: lost committed response replays the same key; stock moves once and uncertain document fields remain locked`,
      );
    }
    assert.deepEqual(touchErrors, []);
    return checks;
  } finally {
    await touch.close();
  }
}
