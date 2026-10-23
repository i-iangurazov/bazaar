import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import { expect as baseExpect } from "playwright/test";

const expect = baseExpect.configure({ timeout: 60_000 });
type Api = (name: string, input: unknown, mutation?: boolean) => Promise<any>;

export async function verifyPosPhotoAndWholesale(
  page: Page,
  base: string,
  fixture: { storeId: string; emptyStoreId: string; unitId: string },
  api: Api,
  output: string,
) {
  assert.equal(
    new URL(base).hostname,
    "localhost",
    "Photo/price fixtures require isolated localhost",
  );
  await mkdir(output, { recursive: true });
  page.setDefaultTimeout(60_000);
  const profile = await api("orgSettings.getBusinessProfile", { storeId: fixture.storeId });
  const toggle = (enabled: boolean) =>
    api(
      "orgSettings.updateBusinessProfile",
      {
        storeId: fixture.storeId,
        organizationName: profile.organization.name,
        retailWholesaleEnabled: enabled,
      },
      true,
    );
  const name = `Фото и опт QA ${randomUUID().slice(0, 8)}`;
  const photoUrl = "/marketing/captures/pos-desktop-wide.webp";
  const targetStore = (await api("stores.list", undefined)).find(
    (store: { id: string }) => store.id === fixture.emptyStoreId,
  );
  assert(targetStore);
  const checks: string[] = [];
  try {
    await toggle(true);
    const product = await api(
      "products.create",
      {
        storeId: fixture.storeId,
        baseUnitId: fixture.unitId,
        name,
        basePriceKgs: 125,
        retailPriceKgs: 125,
        wholesalePriceKgs: 80,
        initialOnHand: 10,
        images: [{ url: `${base}${photoUrl}`, position: 0 }],
        idempotencyKey: randomUUID(),
      },
      true,
    );
    const listUrl = (storeId: string) =>
      `${base}/products?storeId=${storeId}&q=${encodeURIComponent(name)}&view=table`;
    const prices = async (storeId = fixture.storeId) =>
      (await api("products.list", { storeId, search: name })).items.find(
        (item: { id: string }) => item.id === product.id,
      );
    const cell = (storeId = fixture.storeId) =>
      page
        .locator(`[data-inline-cell="products:${storeId}:${product.id}:wholesalePrice"]`)
        .filter({ visible: true })
        .first();
    const editor = () =>
      page.getByRole("spinbutton", { name: "Редактирование поля: Оптовая цена", exact: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(listUrl(fixture.storeId));
    await page
      .getByRole("button", { name: "Колонки", exact: true })
      .filter({ visible: true })
      .click();
    const choice = page.getByRole("menuitemcheckbox", { name: "Оптовая цена", exact: true });
    await expect(choice).toBeVisible();
    if ((await choice.getAttribute("aria-checked")) !== "true") await choice.click();
    await page.keyboard.press("Escape");
    await expect(cell()).toContainText("80");
    await cell().dblclick();
    await editor().fill("0");
    await editor().press("Enter");
    await expect(editor()).toBeHidden();
    await expect.poll(async () => (await prices()).wholesalePriceKgs).toBe(0);
    assert.equal((await prices()).effectivePriceKgs, 125);
    assert.equal((await prices()).onHandQty, 10);
    await page.reload();
    await expect(cell()).toContainText("0");
    await cell().dblclick();
    await editor().fill("999");
    await editor().press("Escape");
    assert.equal((await prices()).wholesalePriceKgs, 0);

    // A failed save keeps the typed value and supports retry through the same editor.
    let fail = true;
    await page.route("**/api/trpc/storePrices.upsert*", async (route) => {
      if (!fail) return route.continue();
      fail = false;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            json: {
              message: "unexpectedError",
              code: -32603,
              data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
            },
          },
        }),
      });
    });
    await cell().dblclick();
    await editor().fill("55");
    const failed = page.waitForResponse(
      (response) => response.url().includes("storePrices.upsert") && response.status() === 500,
    );
    await editor().press("Enter");
    await failed;
    await expect(editor()).toHaveValue("55");
    await expect(editor()).toBeEditable();
    assert.equal((await prices()).wholesalePriceKgs, 0);
    await editor().press("Enter");
    await expect(editor()).toBeHidden();
    await expect.poll(async () => (await prices()).wholesalePriceKgs).toBe(55);
    await page.unroute("**/api/trpc/storePrices.upsert*");
    await cell().dblclick();
    await editor().fill("");
    await editor().press("Enter");
    await expect(editor()).toBeHidden();
    await expect.poll(async () => (await prices()).wholesalePriceKgs).toBeNull();
    assert.equal((await prices()).effectivePriceKgs, 125);
    await api(
      "storePrices.upsert",
      { storeId: fixture.storeId, productId: product.id, wholesalePriceKgs: 80 },
      true,
    );
    await api(
      "products.assignToStore",
      { storeId: fixture.emptyStoreId, productIds: [product.id] },
      true,
    );
    await api(
      "storePrices.upsert",
      { storeId: fixture.emptyStoreId, productId: product.id, wholesalePriceKgs: 13 },
      true,
    );
    await page.goto(listUrl(fixture.emptyStoreId));
    await expect(cell(fixture.emptyStoreId)).toContainText("13");
    await api(
      "orgSettings.updateBusinessProfile",
      {
        storeId: fixture.emptyStoreId,
        organizationName: profile.organization.name,
        currencyCode: "USD",
        currencyRateKgsPerUnit: 86,
      },
      true,
    );
    await api(
      "storePrices.upsert",
      {
        storeId: fixture.emptyStoreId,
        productId: product.id,
        retailPriceKgs: 258,
        wholesalePriceKgs: 129,
      },
      true,
    );
    await page.reload();
    await cell(fixture.emptyStoreId).dblclick();
    await expect(editor()).toHaveValue("1.5");
    await editor().fill("2.5");
    await editor().press("Enter");
    await expect(editor()).toBeHidden();
    await expect.poll(async () => (await prices(fixture.emptyStoreId)).wholesalePriceKgs).toBe(215);
    assert.equal((await prices(fixture.emptyStoreId)).effectivePriceKgs, 258);
    await page.goto(listUrl(fixture.storeId));
    await expect(cell()).toContainText("80");
    await page.screenshot({ path: `${output}/wholesale-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(cell()).toContainText("80");
    await cell().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/wholesale-mobile.png` });
    checks.push(
      "Wholesale column: visibility survives reload; double-click saves zero/clearing, Escape cancels, failure retains draft/retry, and store prices stay separate",
    );

    const register = await api(
      "pos.registers.create",
      { storeId: fixture.storeId, name, code: randomUUID().slice(0, 8) },
      true,
    );
    await api(
      "pos.shifts.open",
      { registerId: register.id, openingCashKgs: 0, idempotencyKey: randomUUID() },
      true,
    );
    const sale = await api("pos.sales.createDraft", { registerId: register.id }, true);
    await api("pos.sales.addLine", { saleId: sale.id, productId: product.id, qty: 1 }, true);
    const saleState = async () => {
      const saved = await api("pos.sales.get", { saleId: sale.id });
      return {
        id: saved.id,
        total: saved.totalKgs,
        lines: saved.lines.map((line: { id: string; qty: number; unitPriceKgs: number }) => ({
          id: line.id,
          qty: line.qty,
          price: line.unitPriceKgs,
        })),
      };
    };
    const browser = page.context().browser();
    assert(browser);
    const touch = await browser.newContext({
      storageState: await page.context().storageState(),
      hasTouch: true,
      ignoreHTTPSErrors: true,
      reducedMotion: "reduce",
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
        const activate = (locator: ReturnType<Page["locator"]>) =>
          width === 1440 ? locator.click() : locator.tap();
        console.log(`Checking POS photo ${width}px`);
        await current.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await current.goto(`${base}/pos/sell?registerId=${register.id}`);
        const cartThumb = current
          .getByTestId("pos-cart-line")
          .getByRole("button", { name: `Открыть фото: ${name}`, exact: true })
          .first();
        await expect(cartThumb).toBeVisible();
        const cartBefore = await saleState();
        await activate(cartThumb);
        await expect(current.getByTestId("pos-photo-dialog")).toBeVisible();
        await activate(current.getByTestId("pos-photo-preview"));
        await expect(current.getByTestId("pos-photo-dialog")).toBeHidden();
        assert.deepEqual(await saleState(), cartBefore);
        if (width === 390)
          await current.getByRole("button", { name: "Добавить товары", exact: true }).click();
        const search = current.locator("input[role=combobox]").filter({ visible: true }).first();
        await search.fill(name);
        const thumb = current
          .getByTestId("pos-product-button")
          .getByRole("button", { name: `Открыть фото: ${name}`, exact: true })
          .filter({ visible: true });
        await expect(thumb).toBeVisible();
        const before = await saleState();
        await activate(thumb);
        const dialog = current.getByTestId("pos-photo-dialog");
        const photo = current.getByTestId("pos-photo-preview");
        await expect(photo).toBeVisible();
        await expect
          .poll(() =>
            photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
          )
          .toBe(true);
        await expect(dialog.getByRole("status")).toHaveCount(0);
        const box = await dialog.boundingBox();
        assert(
          box &&
            box.x > 0 &&
            box.y > 0 &&
            box.width < width &&
            box.height < (width === 390 ? 844 : 900),
          "Preview must be large with visible margins",
        );
        assert(box.width > Math.min(300, width * 0.7));
        await expect(photo).toHaveCSS("object-fit", "contain");
        const picture = await photo.boundingBox();
        assert(
          picture &&
            Math.abs(box.width - picture.width) < 2 &&
            Math.abs(box.height - picture.height) < 2,
          "The photo preview must fit the image without a fixed frame or header",
        );
        await current.screenshot({ path: `${output}/photo-${width}.png` });
        if (width === 1440) {
          let scans = 0;
          const watchScan = (request: { url: () => string }) => {
            if (request.url().includes("products.lookupScan")) scans += 1;
          };
          current.on("request", watchScan);
          await dialog.focus();
          await current.keyboard.type("1234567890123");
          await current.keyboard.press("Enter");
          await expect(dialog).toBeVisible();
          assert.equal(scans, 0);
          current.off("request", watchScan);
        }
        console.log(`Checking POS photo ${width}px close gestures`);
        await activate(photo);
        await expect(dialog).toBeHidden();
        await expect(thumb).toBeFocused();
        await expect(search).toHaveValue(name);
        assert.deepEqual(await saleState(), before);
        await activate(thumb);
        await dialog.waitFor();
        if (width === 1440) await current.mouse.click(1, 1);
        else await current.touchscreen.tap(1, 1);
        await expect(dialog).toBeHidden();
        await activate(thumb);
        await dialog.waitFor();
        await current.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await activate(thumb);
        await dialog.waitFor();
        await activate(dialog.getByRole("button", { name: "Закрыть", exact: true }));
        await expect(dialog).toBeHidden();
        assert.deepEqual(await saleState(), before);
        checks.push(
          `POS photo ${width}px: image-sized preview closes by photo/background/Escape/close button; search and receipt are preserved`,
        );
      }
      assert.deepEqual(touchErrors, []);
    } finally {
      await touch.close();
    }
    // A fresh context without a service worker makes the injected image failure deterministic.
    const faultContext = await browser.newContext({
      storageState: await page.context().storageState(),
      ignoreHTTPSErrors: true,
      serviceWorkers: "block",
      reducedMotion: "reduce",
    });
    let rejectImage = true;
    try {
      await faultContext.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (url.pathname === photoUrl && rejectImage)
          return route.fulfill({ status: 503, body: "temporary fixture failure" });
        if (url.pathname === photoUrl)
          return route.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="640"><rect width="320" height="640" fill="#dbeafe"/><rect x="80" y="60" width="160" height="520" rx="40" fill="#2563eb"/></svg>',
          });
        return route.continue();
      });
      const faultPage = await faultContext.newPage();
      const faultErrors: string[] = [];
      faultPage.on("pageerror", (error) => faultErrors.push(error.message));
      await faultPage.goto(`${base}/pos/sell?registerId=${register.id}`);
      await faultPage
        .getByTestId("pos-cart-line")
        .getByRole("button", { name: `Открыть фото: ${name}`, exact: true })
        .first()
        .click();
      const dialog = faultPage.getByTestId("pos-photo-dialog");
      await expect(dialog.getByText("Не удалось загрузить фото.", { exact: true })).toBeVisible();
      rejectImage = false;
      await dialog.getByRole("button", { name: "Повторить", exact: true }).click();
      const photo = faultPage.getByTestId("pos-photo-preview");
      await expect
        .poll(() =>
          photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
        )
        .toBe(true);
      await expect(dialog.getByRole("status")).toHaveCount(0);
      await faultPage.setViewportSize({ width: 390, height: 844 });
      await expect(photo).toHaveCSS("object-fit", "contain");
      const portrait = await photo.boundingBox();
      assert(
        portrait && portrait.height > 400 && portrait.y > 0 && portrait.y + portrait.height < 844,
      );
      const portraitDialog = await dialog.boundingBox();
      assert(
        portraitDialog &&
          portrait &&
          Math.abs(portraitDialog.width - portrait.width) < 2 &&
          Math.abs(portraitDialog.height - portrait.height) < 2,
        "Portrait photos must not have empty side panels",
      );
      await faultPage.screenshot({ path: `${output}/photo-portrait-mobile.png` });
      await photo.click();
      await expect(dialog).toBeHidden();
      assert.deepEqual(faultErrors, []);
      checks.push(
        "POS photo: temporary loading failure offers retry and recovers without closing the preview",
      );
    } finally {
      await faultContext.close();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await toggle(false);
    await page.goto(listUrl(fixture.storeId));
    if (
      !(await page
        .getByRole("button", { name: "Колонки", exact: true })
        .filter({ visible: true })
        .count())
    )
      await page.getByRole("button", { name: "Вид списка", exact: true }).click();
    await page
      .getByRole("button", { name: "Колонки", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole("menuitemcheckbox", { name: "Оптовая цена", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(cell()).toHaveCount(0);
    checks.push(
      "Wholesale column is hidden when the feature is disabled; stored prices remain intact",
    );
  } finally {
    await api(
      "orgSettings.updateBusinessProfile",
      {
        storeId: fixture.emptyStoreId,
        organizationName: profile.organization.name,
        currencyCode: targetStore.currencyCode,
        currencyRateKgsPerUnit: Number(targetStore.currencyRateKgsPerUnit),
      },
      true,
    );
    await toggle(profile.organization.retailWholesaleEnabled);
  }
  return checks;
}
