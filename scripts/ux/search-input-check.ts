import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import { expect } from "playwright/test";

export async function verifySearchInputs(
  page: Page,
  base: string,
  fixture: {
    storeId: string;
    otherStoreId: string;
    registerId: string;
    searchProductName?: string;
  },
  directory: string,
) {
  await mkdir(directory, { recursive: true });
  const productName = fixture.searchProductName ?? "Чай чёрный листовой, 100 г";
  const checks: string[] = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const path of [
      `/inventory/receiving?storeId=${fixture.storeId}`,
      `/inventory/write-offs?storeId=${fixture.storeId}`,
      `/inventory/transfers?fromStoreId=${fixture.storeId}&toStoreId=${fixture.otherStoreId}`,
    ]) {
      await page.goto(base + path);
      const input = page.locator("main input[type=search]").filter({ visible: true }).first();
      await expect(input).toBeEnabled({ timeout: 60_000 });
      const results = page.locator(".bazaar-doc-search-list").filter({ visible: true });
      await input.fill(productName);
      await expect(results.locator(".bazaar-doc-search-row").first()).toContainText(productName);
      await input.fill("нет-такого-товара-search-qa");
      await expect(results).not.toContainText(productName);
      const clear = input
        .locator("..")
        .getByRole("button", { name: "Очистить поиск", exact: true });
      await clear.click();
      await expect(input).toHaveValue("");
      assert(
        await input.evaluate((element) => document.activeElement === element),
        "Clear must retain search focus",
      );
      await input.pressSequentially(productName, { delay: 5 });
      await expect(input).toHaveValue(productName);
      await expect(results.locator(".bazaar-doc-search-row").first()).toContainText(productName);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({
        path: `${directory}/${path.split("?")[0].split("/").at(-1)}-${width}.png`,
      });
      checks.push(
        `${path.split("?")[0]} ${width}: relevance, rapid typing, no stale results, clear/focus`,
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [path, selector, parameter] of [
    ["/products", "input[type=search]", ""],
    ["/inventory", "input[type=search]", ""],
    ["/customers", "#customer-search", "search"],
    ["/suppliers", "input[type=search]", "q"],
    ["/purchase-orders", "input[type=search]", "search"],
    ["/sales/orders", "input[type=search]", "search"],
    ["/inventory/movements", "#movement-search", "search"],
    ["/pos/history", "input[type=search]", "q"],
    ["/settings/categories", "input[type=search]", ""],
    ["/reports/analytics", "input[type=search]", ""],
  ]) {
    const dates = path === "/reports/analytics" ? "&dateFrom=2026-10-01&dateTo=2026-10-07" : "";
    await page.goto(`${base}${path}?storeId=${fixture.storeId}&registerId=${fixture.registerId}${dates}`);
    const input = page.locator("main").locator(selector).filter({ visible: true }).first();
    await expect(input).toBeEnabled({ timeout: 60_000 });
    await input.fill("");
    const query = "Search_QA_123";
    await input.pressSequentially(query, { delay: 10 });
    await expect(input).toHaveValue(query);
    if (parameter) {
      await expect.poll(() => new URL(page.url()).searchParams.get(parameter)).toBe(query);
      await page.reload();
      await expect(input).toHaveValue(query);
    }
    await input.press("ControlOrMeta+a");
    await input.press("Backspace");
    await expect(input).toHaveValue("");
    if (parameter)
      await expect.poll(() => new URL(page.url()).searchParams.get(parameter)).toBeNull();
    checks.push(`${path}: rapid typing, replacement, clear, URL persistence`);
  }
  await page.goto(`${base}/products?storeId=${fixture.storeId}`);
  const header = page.locator("input[data-tour=scan-input]").filter({ visible: true });
  await header.fill(productName);
  const list = page.getByRole("listbox").filter({ hasText: productName });
  await expect(list).toBeVisible();
  const triggerBox = await header.boundingBox(),
    listBox = await list.boundingBox();
  assert(
    triggerBox && listBox && Math.abs(triggerBox.width - listBox.width) < 2,
    "Dropdown must match the search field width",
  );
  await page.locator("main h1").first().click();
  await expect(list).toBeHidden();
  await header.click();
  await expect(list).toBeVisible();
  await header.press("ArrowDown");
  await header.press("Escape");
  await expect(list).toBeHidden();
  await header.locator("..").getByRole("button", { name: "Очистить поиск", exact: true }).click();
  await expect(header).toHaveValue("");
  checks.push(
    "Global search: dropdown width, outside click, keyboard navigation, Escape and clear",
  );
  return checks;
}
