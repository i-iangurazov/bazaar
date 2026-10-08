import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import { expect as baseExpect } from "playwright/test";

const expect = baseExpect.configure({ timeout: 60_000 });
type Api = (name: string, input: unknown, mutation?: boolean) => Promise<unknown>;
type BarcodeDiagnostics = {
  exactBarcodeMatches: Array<{
    id: string;
    name: string;
    isDeleted: boolean;
    canTransfer: boolean;
  }>;
};

export async function verifyProductBarcodeTransfer(
  page: Page,
  base: string,
  fixture: { storeId: string },
  api: Api,
  output: string,
) {
  assert.equal(new URL(base).hostname, "localhost", "Barcode fixtures require isolated localhost");
  await mkdir(output, { recursive: true });
  page.setDefaultTimeout(60_000);
  const units = (await api("units.list", undefined)) as Array<{ id: string }>;
  const profile = (await api("orgSettings.getBusinessProfile", { storeId: fixture.storeId })) as {
    organization: { retailWholesaleEnabled: boolean };
  };
  const priceModes = profile.organization.retailWholesaleEnabled
    ? { retailPriceKgs: 400, wholesalePriceKgs: 400 }
    : {};
  const checks: string[] = [];
  for (const width of [1440, 390]) {
    const barcode = `ARCHIVE-${randomUUID()}`;
    const name = `Горелка новая ${width} QA ${randomUUID().slice(0, 8)}`;
    const source = (await api(
      "products.create",
      {
        idempotencyKey: randomUUID(),
        storeId: fixture.storeId,
        name: `Горелка архивная ${width} QA`,
        baseUnitId: units[0].id,
        basePriceKgs: 400,
        ...priceModes,
        barcodes: [barcode],
        initialOnHand: 1,
      },
      true,
    )) as { id: string; name: string };
    await api("products.archive", { productId: source.id }, true);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(
      `${base}/products/new?storeId=${fixture.storeId}&barcode=${encodeURIComponent(barcode)}`,
    );
    await page
      .getByRole("textbox", { name: /^Название/ })
      .first()
      .fill(name);
    const price = profile.organization.retailWholesaleEnabled
      ? page.getByLabel(/^Розничная цена/).first()
      : page.getByLabel("Цена продажи", { exact: true }).first();
    await price.fill("400");
    const conflict = page.locator(`[data-barcode-conflict="${barcode}"]`).filter({ visible: true });
    await expect(conflict).toContainText(source.name);
    await expect(conflict).toContainText("Архив");
    await conflict.scrollIntoViewIfNeeded();
    const transfer = conflict.getByRole("button", { name: "Перенести штрихкод", exact: true });
    await expect(transfer).toBeEnabled();
    const popupPromise = page.waitForEvent("popup");
    await conflict.getByRole("link", { name: "Показать в архиве", exact: true }).click();
    const popup = await popupPromise;
    await expect(popup.getByText(source.name, { exact: true }).first()).toBeVisible();
    await popup.close();
    await transfer.click();
    const cancel = conflict.getByRole("button", { name: "Отменить перенос", exact: true });
    await expect(cancel).toHaveAttribute("aria-pressed", "true");
    await expect(conflict.getByRole("status")).toContainText("При сохранении");
    const beforeSave = (await api("products.duplicateDiagnostics", {
      barcodes: [barcode],
    })) as BarcodeDiagnostics;
    assert.equal(
      beforeSave.exactBarcodeMatches[0].id,
      source.id,
      "Selecting a transfer must not change its owner before save",
    );
    await cancel.click();
    await expect(transfer).toHaveAttribute("aria-pressed", "false");
    await transfer.click();
    await page.screenshot({ path: `${output}/barcode-transfer-${width}.png` });
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/trpc/products.create") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    const response = await responsePromise;
    assert.equal(response.status(), 200, await response.text());
    await expect(page).toHaveURL(/\/products(?:\?|$)/);
    const diagnostics = (await api("products.duplicateDiagnostics", {
      barcodes: [barcode],
    })) as BarcodeDiagnostics;
    assert.equal(diagnostics.exactBarcodeMatches[0].name, name);
    assert.equal(diagnostics.exactBarcodeMatches[0].isDeleted, false);
    assert.equal(diagnostics.exactBarcodeMatches[0].canTransfer, false);
    checks.push(
      `Product editor ${width}px: archived barcode shown, archive link, consent/cancel and transactional save work`,
    );
  }
  return checks;
}
