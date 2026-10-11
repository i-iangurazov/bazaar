import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import { expect as baseExpect } from "playwright/test";

const expect = baseExpect.configure({ timeout: 60_000 });
type Api = (name: string, input: unknown, mutation?: boolean) => Promise<unknown>;
type ProductDetail = {
  baseUnitId: string;
  unit: string;
  avgCostKgs: number | null;
  basePriceKgs: number | null;
};
type ProductList = { items: Array<{ id: string; onHandQty: number; effectivePriceKgs: number }> };

export async function verifyProductUnitChange(
  page: Page,
  base: string,
  fixture: { storeId: string },
  api: Api,
  output: string,
) {
  assert.equal(new URL(base).hostname, "localhost", "Unit fixtures require isolated localhost");
  await mkdir(output, { recursive: true });
  page.setDefaultTimeout(60_000);
  const profile = (await api("orgSettings.getBusinessProfile", { storeId: fixture.storeId })) as {
    organization: { retailWholesaleEnabled: boolean };
  };
  const checks: string[] = [];
  for (const width of [1440, 390]) {
    const suffix = randomUUID().slice(0, 8);
    const name = `Кабель с остатком ${width} QA ${suffix}`;
    const piece = (await api(
      "units.create",
      {
        code: `piece-${suffix}`,
        labelRu: `шт QA ${suffix}`,
        labelKg: "даана",
        quantityPrecision: 0,
      },
      true,
    )) as { id: string };
    const meter = (await api(
      "units.create",
      { code: `m-${suffix}`, labelRu: `м QA ${suffix}`, labelKg: "м", quantityPrecision: 3 },
      true,
    )) as { id: string; code: string; labelRu: string };
    const product = (await api(
      "products.create",
      {
        idempotencyKey: randomUUID(),
        storeId: fixture.storeId,
        name,
        baseUnitId: piece.id,
        basePriceKgs: 100,
        avgCostKgs: 40,
        initialOnHand: 5,
        ...(profile.organization.retailWholesaleEnabled
          ? { retailPriceKgs: 100, wholesalePriceKgs: 100 }
          : {}),
      },
      true,
    )) as { id: string };
    const before = (await api("products.getById", { productId: product.id })) as ProductDetail;
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(`${base}/products/${product.id}?storeId=${fixture.storeId}`);
    const unit = page
      .getByRole("combobox", { name: "Единица измерения", exact: true })
      .filter({ visible: true });
    await expect(unit).toBeEnabled();
    await unit.scrollIntoViewIfNeeded();
    await unit.click();
    await page.getByRole("option", { name: meter.labelRu, exact: true }).click();
    await expect(
      page.getByText("Количество и цены не пересчитываются.", { exact: true }),
    ).toBeVisible();
    const response = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("products.update"),
    );
    await page
      .getByRole("button", { name: "Сохранить", exact: true })
      .filter({ visible: true })
      .click();
    const saved = await response;
    assert.equal(saved.status(), 200, await saved.text());
    const after = (await api("products.getById", { productId: product.id })) as ProductDetail;
    assert.equal(after.baseUnitId, meter.id);
    assert.equal(after.unit, meter.code);
    assert.equal(after.avgCostKgs, before.avgCostKgs);
    assert.equal(after.basePriceKgs, before.basePriceKgs);
    const list = (await api("products.list", {
      storeId: fixture.storeId,
      search: name,
    })) as ProductList;
    const row = list.items.find((p) => p.id === product.id);
    assert.ok(row);
    assert.equal(row.onHandQty, 5);
    assert.equal(row.effectivePriceKgs, 100);
    await page.reload();
    await expect(unit).toContainText(meter.labelRu);
    await unit.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${output}/unit-change-${width}.png` });
    checks.push(
      `Product unit ${width}px: initially stocked product changes from pieces to meters, survives reload and preserves stock, price and cost`,
    );
  }
  return checks;
}
