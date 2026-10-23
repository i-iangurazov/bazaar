import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import { expect as baseExpect } from "playwright/test";

const expect = baseExpect.configure({ timeout: 60_000 });
type Api = (name: string, input: unknown, mutation?: boolean) => Promise<unknown>;

/** A long receiving draft must not pull the operator away from the catalog. */
export async function verifyReceivingSelection(
  page: Page,
  base: string,
  fixture: { storeId: string; unitId: string },
  api: Api,
  output: string,
) {
  assert.equal(new URL(base).hostname, "localhost", "Receiving checks require isolated localhost");
  await mkdir(output, { recursive: true });
  const nonce = randomUUID().slice(0, 8);
  const prefix = `Оприходование QA ${nonce}`;
  const units = (await api("units.list", undefined)) as { id: string; code: string }[];
  const unit = units.find((candidate) => candidate.id === fixture.unitId);
  assert(unit);
  const rows = Array.from({ length: 30 }, (_, index) => ({
    name: `${prefix} ${String(index).padStart(2, "0")}`,
    sku: `RECEIVE-${nonce}-${index}`,
    unit: unit.code,
    basePriceKgs: 100,
    avgCostKgs: 15,
    stockQty: 10,
  }));
  await api("products.importCsv", {
    storeId: fixture.storeId, rows, stockBehavior: "set", idempotencyKey: randomUUID(),
  }, true);
  const products = (await api("inventory.searchProducts", {
    storeId: fixture.storeId, search: prefix, searchFields: ["name"], limit: 100,
  })) as { product: { id: string; name: string }; snapshot: { onHand: number } }[];
  assert.equal(products.length, 30);
  const receiving = (await api("inventory.postStockReceiving", {
    storeId: fixture.storeId,
    lines: products.slice(0, 24).map(({ product }) => ({
      productId: product.id, quantity: 2, unitCost: 4,
    })),
    idempotencyKey: randomUUID(),
  }, true)) as { receivingId: string };

  const browser = page.context().browser();
  assert(browser);
  const touch = await browser.newContext({
    storageState: await page.context().storageState(),
    hasTouch: true, ignoreHTTPSErrors: true, reducedMotion: "reduce",
  });
  await touch.route("**/*", (route) =>
    new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
  );
  const touchPage = await touch.newPage();
  const touchErrors: string[] = [];
  touchPage.on("pageerror", (error) => touchErrors.push(error.message));
  const checks: string[] = [];
  try {
    for (const [width, editing] of [[1440, false], [1024, false], [390, false], [1440, true]] as const) {
      const current = width === 1440 ? page : touchPage;
      await current.setViewportSize({ width, height: width === 390 ? 844 : 768 });
      await current.goto(editing
        ? `${base}/inventory/receiving/${receiving.receivingId}/edit`
        : `${base}/inventory/receiving?storeId=${fixture.storeId}`);
      const search = current.getByRole("searchbox", { name: "Найти товар", exact: true });
      await expect(search).toBeEnabled();
      await search.fill(prefix);
      const results = current.locator(".bazaar-doc-search-row > button");
      const lines = current.locator("[data-receiving-line-row]");
      await expect(results).toHaveCount(30);
      if (editing) {
        await expect(lines).toHaveCount(24);
      } else {
        for (let index = 0; index < 24; index += 1) {
          await results.nth(index).click();
          await expect(lines).toHaveCount(index + 1);
        }
      }
      const selected = results.nth(25);
      await selected.scrollIntoViewIfNeeded();
      const position = () => current.evaluate(() => ({
        page: window.scrollY,
        catalog: document.querySelector(".bazaar-doc-search-list")?.scrollTop ?? -1,
      }));
      const before = await position();
      assert(before.catalog > 0, "Fixture must exercise a scrolled catalog");
      if (width === 1440) await selected.click();
      else await selected.tap();
      await expect(lines).toHaveCount(25);
      const added = lines.filter({ hasText: await selected.locator(".font-medium").first().innerText() });
      const quantity = added.locator('[data-receiving-input="quantity"]');
      const cost = added.locator('[data-receiving-input="unitCost"]');
      await current.evaluate(() => new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ));
      await expect(quantity).toBeFocused();
      assert.deepEqual(await position(), before, "Adding must focus quantity without scrolling away from the catalog");
      await expect(search).toHaveValue(prefix);
      await expect(quantity).toHaveValue("1");
      await current.keyboard.press("ControlOrMeta+A");
      await current.keyboard.type("7");
      await expect(quantity).toHaveValue("7");
      await cost.fill("12.5");
      await selected.scrollIntoViewIfNeeded();
      const duplicatePosition = await position();
      if (width === 1440) await selected.click();
      else await selected.tap();
      await current.evaluate(() => new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ));
      await expect(quantity).toBeFocused();
      assert.deepEqual(await position(), duplicatePosition, "Reselecting must preserve focus and catalog position");
      await expect(lines).toHaveCount(25);
      await expect(quantity).toHaveValue("7");
      await expect(cost).toHaveValue("12.5");
      await expect(added).toContainText("Товар уже добавлен.");
      assert(await current.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await current.screenshot({ path: `${output}/${editing ? "edit" : "new"}-${width}.png` });

      // Quantity keyboard navigation remains intentional, including offscreen rows.
      const firstQuantity = lines.first().locator('[data-receiving-input="quantity"]');
      const secondQuantity = lines.nth(1).locator('[data-receiving-input="quantity"]');
      await firstQuantity.focus();
      await firstQuantity.press("Enter");
      await expect(secondQuantity).toBeFocused();
      await secondQuantity.press("Shift+Enter");
      await expect(firstQuantity).toBeFocused();
      checks.push(`Receiving ${editing ? "edit" : "new"} ${width}px: quantity remains focused without scrolling the catalog; keyboard entry, preserved quantities/costs and Enter navigation work`);
    }

    // Returning from product creation is a different, explicit quantity-entry flow.
    await page.getByRole("button", { name: "Создать товар", exact: true }).click();
    await expect(page).toHaveURL(/\/products\/new\?/);
    const profile = (await api("orgSettings.getBusinessProfile", { storeId: fixture.storeId })) as {
      organization: { retailWholesaleEnabled: boolean };
    };
    const createdName = `Новый товар QA ${nonce}`;
    const form = page.locator("form").filter({ has: page.locator('input[name="name"]') });
    await form.locator('input[name="name"]').fill(createdName);
    await form.locator(`input[name="${profile.organization.retailWholesaleEnabled ? "retailPriceKgs" : "basePriceKgs"}"]`).fill("100");
    const createdResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && response.url().includes("products.create"),
    );
    await form.evaluate((element: HTMLFormElement) => element.requestSubmit());
    assert.equal((await createdResponse).status(), 200);
    await expect(page).toHaveURL(/\/inventory\/receiving\/.*createdProductId=/);
    const returnedLines = page.locator("[data-receiving-line-row]");
    await expect(returnedLines).toHaveCount(26);
    await expect(returnedLines.filter({ hasText: createdName })
      .locator('[data-receiving-input="quantity"]')).toBeFocused();
    await expect(page.getByRole("searchbox", { name: "Найти товар", exact: true })).toHaveValue(prefix);
    assert.deepEqual(touchErrors, []);
    checks.push("Receiving: a created product returns to the preserved draft and intentionally focuses its quantity");
  } finally {
    await touch.close();
  }
  return checks;
}
