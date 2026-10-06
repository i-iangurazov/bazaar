import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import { expect } from "playwright/test";

type Api = (name: string, input: unknown, mutation?: boolean) => Promise<unknown>;

/** Exercise real editor requests, feature toggles and narrow mobile cards. */
export async function verifyProductEditor(
  page: Page,
  base: string,
  fixture: { storeId: string; unitId: string },
  api: Api,
  output: string,
) {
  await mkdir(output, { recursive: true });
  page.setDefaultTimeout(45_000);
  const profile = (await api("orgSettings.getBusinessProfile", { storeId: fixture.storeId })) as {
    organization: { name: string; retailWholesaleEnabled: boolean };
  };
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
  try {
    await toggle(false);
    const legacy = (await api(
      "products.create",
      {
        storeId: fixture.storeId,
        baseUnitId: fixture.unitId,
        basePriceKgs: 75,
        name: "QA legacy editor price",
        idempotencyKey: randomUUID(),
      },
      true,
    )) as { id: string };
    await page.goto(`${base}/products/${legacy.id}?storeId=${fixture.storeId}`);
    await expect(page.locator('input[name="basePriceKgs"]')).toBeVisible();
    await expect(page.locator('input[name="retailPriceKgs"]')).toHaveCount(0);
    await toggle(true);
    await page.reload();
    await expect(page.locator('input[name="retailPriceKgs"]')).toHaveValue("75");
    await expect(page.locator('input[name="basePriceKgs"]')).toHaveCount(0);
    await expect(page.locator('input[name="storePriceKgs"]')).toHaveCount(0);
    await page.goto(`${base}/products/new?storeId=${fixture.storeId}`);
    const form = page.locator("form").filter({ has: page.locator('input[name="name"]') });
    await expect(form.locator('input[name="retailPriceKgs"]')).toBeVisible();
    const headings = await form.locator("h2").allTextContents();
    assert(headings.includes("Штрихкоды"), "Barcode has a stable editor section");
    const name = `Хомут пластиковый для крепления кабелей, усиленный, белый, 500 × 9 мм · ${randomUUID()}`;
    await form.locator('input[name="name"]').fill(name);
    await form.evaluate((element: HTMLFormElement) => element.requestSubmit());
    await expect(form.getByText("Укажите розничную цену.", { exact: true })).toBeVisible();
    assert(new URL(page.url()).pathname === "/products/new");
    await form.locator('input[name="retailPriceKgs"]').fill("0");
    await expect(form.locator('input[name="wholesalePriceKgs"]')).toHaveValue("");
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().includes("products.create"),
    );
    await form.evaluate((element: HTMLFormElement) => element.requestSubmit());
    assert.equal((await createdResponse).status(), 200);
    await page.waitForURL((url) => url.pathname === "/products");
    const list = (await api("products.list", { storeId: fixture.storeId, search: name })) as {
      items: Array<{ id: string; name: string; effectivePriceKgs: number }>;
    };
    const product = list.items.find((item) => item.name === name);
    assert(product, "The created product must persist");
    assert.equal(product.effectivePriceKgs, 0);
    await page.goto(`${base}/products/${product.id}?storeId=${fixture.storeId}`);
    await expect(page.locator('input[name="retailPriceKgs"]')).toHaveValue("0");
    const editForm = page.locator("form").filter({ has: page.locator('input[name="name"]') });
    assert.deepEqual(
      await editForm.locator("h2").allTextContents(),
      headings,
      "Creation and editing use the same core sections in the same order",
    );
    await editForm.locator('input[name="retailPriceKgs"]').fill("125");
    await editForm.locator('input[name="wholesalePriceKgs"]').fill("90");
    const savedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().includes("products.update"),
    );
    await editForm.evaluate((element: HTMLFormElement) => element.requestSubmit());
    assert.equal((await savedResponse).status(), 200);
    await page.reload();
    await expect(page.locator('input[name="retailPriceKgs"]')).toHaveValue("125");
    await expect(page.locator('input[name="wholesalePriceKgs"]')).toHaveValue("90");
    await page.screenshot({ path: `${output}/editor-prices.png`, fullPage: true });
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(
        `${base}/products?storeId=${fixture.storeId}&search=${encodeURIComponent(name)}`,
      );
      const title = page.locator("[data-product-name]").filter({ hasText: name });
      await expect(title).toHaveText(name);
      const geometry = await title.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          clamp: style.webkitLineClamp,
          overflow: style.overflow,
          height: element.clientHeight,
          scrollHeight: element.scrollHeight,
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
        };
      });
      assert.equal(geometry.clamp, "none");
      assert(
        geometry.scrollHeight <= geometry.height + 1 && geometry.scrollWidth <= geometry.width + 1,
      );
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: `${output}/product-name-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await toggle(false);
    await page.goto(`${base}/products/${product.id}?storeId=${fixture.storeId}`);
    await expect(page.locator('input[name="storePriceKgs"]')).toHaveValue("125");
    await expect(page.locator('input[name="retailPriceKgs"]')).toHaveCount(0);
    const ordinarySave = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().includes("products.update"),
    );
    await page.locator('input[name="storePriceKgs"]').fill("150");
    await editForm.evaluate((element: HTMLFormElement) => element.requestSubmit());
    assert.equal((await ordinarySave).status(), 200);
    await toggle(true);
    await page.reload();
    await expect(page.locator('input[name="retailPriceKgs"]')).toHaveValue("150");
    await expect(page.locator('input[name="wholesalePriceKgs"]')).toHaveValue("90");
  } finally {
    await toggle(profile.organization.retailWholesaleEnabled);
  }
}
