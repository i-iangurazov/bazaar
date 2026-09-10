import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";

/** Read-only UI checks: keep the product card's single contour and portalled controls. */
export async function verifyProductTable(
  page: Page,
  base: string,
  storeId: string,
  output: string,
) {
  await mkdir(output, { recursive: true });
  page.setDefaultTimeout(45_000);
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/products?storeId=${storeId}`);
    await page.locator("[data-list-toolbar]").waitFor();
    await page.waitForFunction(
      () => document.querySelector("[data-list-toolbar]")?.getAttribute("aria-busy") !== "true",
    );
    const size = page.getByRole("combobox", { name: "Строк на странице", exact: true });
    await size.click();
    await page.getByRole("option", { name: "10", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector("[data-list-toolbar]")?.getAttribute("aria-busy") !== "true",
    );
    const table = page.locator('[data-component="data-table"]');
    if (width >= 768) {
      const surface = table.locator(":scope > div");
      const contour = await surface.evaluate((el) => {
        const style = getComputedStyle(el);
        const card = el.closest(".rounded-xl.border")!;
        const outer = getComputedStyle(card);
        return {
          radius: style.borderRadius,
          border: style.borderWidth,
          overflowX: style.overflowX,
          outerRadius: outer.borderRadius,
          outerBorder: outer.borderWidth,
        };
      });
      assert.equal(contour.radius, "0px");
      assert.equal(contour.border, "0px");
      assert.equal(contour.overflowX, "auto");
      assert.equal(contour.outerBorder, "1px");
      assert(parseFloat(contour.outerRadius) > 0);
      await table.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/products-${width}-top.png` });
      if (width === 768) {
        await surface.evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
        });
        assert(await surface.evaluate((el) => el.scrollLeft > 0));
      }
    }
    const menuButton = page
      .getByRole("button", { name: "Больше действий", exact: true })
      .filter({ visible: true })
      .last();
    await menuButton.click();
    const menu = page.getByRole("menu");
    await menu.waitFor();
    assert.equal(
      await menu.evaluate((el) => Boolean(el.closest('[data-component="data-table"]'))),
      false,
    );
    const box = await menu.boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= width + 1);
    await page.screenshot({ path: `${output}/products-${width}-menu.png` });
    await page.keyboard.press("Escape");
    const next = page.getByRole("button", { name: "Следующая страница", exact: true });
    await next.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/products-${width}-bottom.png` });
    assert(await next.isEnabled());
    await next.click();
    await page.waitForURL((url) => url.searchParams.get("page") === "2");
    await page.waitForFunction(
      () => document.querySelector("[data-list-toolbar]")?.getAttribute("aria-busy") !== "true",
    );
    await page.getByRole("button", { name: "Предыдущая страница", exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get("page") === "1");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
}
