import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import { expect as baseExpect } from "playwright/test";

const expect = baseExpect.configure({ timeout: 60_000 });
type Api = (name: string, input: unknown, mutation?: boolean) => Promise<unknown>;
type InventoryItem = {
  product: { id: string };
  snapshot: { onHand: number; onOrder: number; version: number };
  minStock: number;
  lowStock: boolean;
};

export async function verifyInventoryMinStock(
  page: Page,
  base: string,
  fixture: { storeId: string },
  api: Api,
  output: string,
) {
  assert.equal(
    new URL(base).hostname,
    "localhost",
    "Minimum stock fixtures require isolated localhost",
  );
  await mkdir(output, { recursive: true });
  page.setDefaultTimeout(60_000);
  const profile = (await api("orgSettings.getBusinessProfile", { storeId: fixture.storeId })) as {
    organization: { retailWholesaleEnabled: boolean };
  };
  const units = (await api("units.list", {})) as Array<{ id: string }>;
  assert.ok(units[0], "The inventory fixture requires an existing unit");
  const checks: string[] = [];
  for (const width of [1440, 768, 390]) {
    const suffix = randomUUID().slice(0, 8);
    const sku = `MIN-UI-${suffix}`;
    const product = (await api(
      "products.create",
      {
        idempotencyKey: randomUUID(),
        storeId: fixture.storeId,
        name: `Минимальный остаток QA ${width} ${suffix}`,
        sku,
        baseUnitId: units[0].id,
        basePriceKgs: 100,
        initialOnHand: 7,
        ...(profile.organization.retailWholesaleEnabled
          ? { retailPriceKgs: 100, wholesalePriceKgs: 100 }
          : {}),
      },
      true,
    )) as { id: string };
    const read = async () => {
      const result = (await api("inventory.list", {
        storeId: fixture.storeId,
        search: sku,
      })) as { items: InventoryItem[] };
      const item = result.items.find((row) => row.product.id === product.id);
      assert.ok(item, "The inventory fixture must be visible in its store");
      return item;
    };
    const before = await read();
    assert.equal(before.snapshot.onHand, 7);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(`${base}/inventory?list=1&storeId=${fixture.storeId}&q=${sku}`);
    await expect(
      page
        .getByText(`Минимальный остаток QA ${width} ${suffix}`, { exact: true })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    const openDialog = async () => {
      await page
        .getByRole("button", { name: width === 390 ? "Больше действий" : "Действия", exact: true })
        .filter({ visible: true })
        .click();
      await page.getByRole("menuitem", { name: "Минимальные остатки", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Минимальные остатки", exact: true });
      await expect(dialog).toBeVisible();
      return dialog;
    };
    let dialog = await openDialog();
    const applyAll = dialog.getByRole("switch", { name: "Применить ко всем товарам", exact: true });
    await applyAll.click();
    await expect(applyAll).toBeChecked();
    await expect(dialog.getByRole("combobox")).toBeDisabled();
    await dialog.getByRole("spinbutton", { name: "Мин. остаток", exact: true }).fill("10");
    await page.screenshot({ path: `${output}/min-stock-${width}.png` });
    const save = async (route: string) => {
      const response = page.waitForResponse(
        (result) => result.request().method() === "POST" && result.url().includes(route),
      );
      await dialog.getByRole("button", { name: "Сохранить порог", exact: true }).click();
      const saved = await response;
      assert.equal(saved.status(), 200, await saved.text());
      const body = await saved.json();
      assert.ok(!body.error, JSON.stringify(body));
      await expect(dialog).not.toBeVisible();
    };
    await save("inventory.setDefaultMinStock");
    let after = await read();
    assert.equal(after.minStock, 10);
    assert.equal(after.lowStock, true);
    assert.deepEqual(
      after.snapshot,
      before.snapshot,
      "Bulk threshold saves must preserve physical stock",
    );
    await page.reload();
    dialog = await openDialog();
    const minimum = dialog.getByRole("spinbutton", { name: "Мин. остаток", exact: true });
    await expect(minimum).toHaveValue("10");
    await minimum.fill("0.5");
    assert.equal(await minimum.evaluate((input: HTMLInputElement) => input.checkValidity()), true);
    await save("inventory.setMinStock");
    after = await read();
    assert.equal(after.minStock, 0.5);
    assert.equal(after.lowStock, false);
    assert.deepEqual(
      after.snapshot,
      before.snapshot,
      "Individual threshold saves must preserve physical stock",
    );
    dialog = await openDialog();
    await dialog.getByRole("spinbutton", { name: "Мин. остаток", exact: true }).fill("0");
    await save("inventory.setMinStock");
    assert.equal((await read()).minStock, 0);
    assert.deepEqual((await read()).snapshot, before.snapshot);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    checks.push(
      `Minimum stock ${width}px: apply-all 10, reload, fractional and zero thresholds save; stock and version remain unchanged`,
    );
  }
  return checks;
}
