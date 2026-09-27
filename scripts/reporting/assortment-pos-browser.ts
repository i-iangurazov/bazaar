import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Fixed disposable reporting runtime and synthetic credentials; no production target.
const base = "https://localhost:3123";
const f = JSON.parse(await readFile("artifacts/reporting/fixture.json", "utf8"));
const m = JSON.parse(await readFile("messages/ru.json", "utf8"));
const out = "artifacts/directional/after";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
  serviceWorkers: "block",
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const errors: string[] = [],
  checks: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
async function api(method: string, input: unknown, mutation = false) {
  const response = mutation
    ? await context.request.post(`${base}/api/trpc/${method}`, { data: { json: input } })
    : await context.request.get(
        `${base}/api/trpc/${method}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
      );
  const data = await response.json();
  if (data.error) throw Error(JSON.stringify(data.error));
  return data.result.data.json;
}
async function until(condition: () => Promise<boolean>, message: string) {
  const end = Date.now() + 30_000;
  while (!(await condition())) {
    if (Date.now() > end) throw Error(message);
    await page.waitForTimeout(100);
  }
}
async function capture(name: string) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${name} overflow`,
  );
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}
try {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ru", url: base }]);
  const csrf = await (await context.request.get(base + "/api/auth/csrf")).json();
  await context.request.post(base + "/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: "admin@test.local",
      password: "BazaarReportTest123!",
      json: "true",
      callbackUrl: base,
    },
  });
  const session = await (await context.request.get(base + "/api/auth/session")).json();
  assert.equal(session.user.organizationId, f.organizationId);
  const products = await api("products.getById", { productId: f.teaId });
  const stamp = Date.now();
  const product = await api(
    "products.create",
    {
      idempotencyKey: crypto.randomUUID(),
      storeId: f.storeId,
      name: `AAAA QA channel ${stamp}`,
      baseUnitId: products.baseUnitId,
      basePriceKgs: 100,
      initialOnHand: 10,
      barcodes: [`QA-${stamp}`],
    },
    true,
  );
  const registers = await api("pos.registers.list", { storeId: f.storeId });
  const register = registers.find((r: { storeId: string }) => r.storeId === f.storeId);
  assert.ok(register);
  const leftover = await api("pos.sales.activeDraft", { registerId: register.id });
  if (leftover) await api("pos.sales.cancelDraft", { saleId: leftover.id }, true);
  const draft = await api(
    "pos.sales.createDraft",
    {
      registerId: register.id,
      requireNewDraft: true,
      lines: [{ productId: product.id, qty: 1 }],
      customerId: f.customerId,
    },
    true,
  );
  await page.goto(base + `/pos/sell?registerId=${register.id}`);
  const checkbox = page.getByRole("checkbox", { name: m.saleChannel.checkbox, exact: true });
  await page.getByTestId("pos-cart-line").first().waitFor();
  await checkbox.waitFor();
  assert.equal(await checkbox.isChecked(), false);
  await capture("pos-desktop-in-store");
  const scanner = page.locator("input").filter({ visible: true }).first();
  await scanner.focus();
  const activeBefore = await page.evaluate(() => document.activeElement?.outerHTML);
  let toggleRequests = 0;
  const count = (request: { method: () => string; url: () => string }) => {
    if (request.method() === "POST" && request.url().includes("/api/trpc/")) toggleRequests += 1;
  };
  page.on("request", count);
  await checkbox.click();
  assert.equal(await checkbox.isChecked(), true);
  // Clicking the larger label target must preserve the scanner just like the square.
  await page.getByText(m.saleChannel.checkbox, { exact: true }).click();
  assert.equal(await checkbox.isChecked(), false);
  assert.equal(await page.evaluate(() => document.activeElement?.outerHTML), activeBefore);
  await page.getByText(m.saleChannel.checkbox, { exact: true }).click();
  await page.waitForTimeout(150);
  page.off("request", count);
  assert.equal(toggleRequests, 0);
  assert.equal(await page.evaluate(() => document.activeElement?.outerHTML), activeBefore);
  assert.equal(await checkbox.isChecked(), true);
  await page.reload();
  await checkbox.waitFor();
  assert.equal(await checkbox.isChecked(), true);
  await capture("pos-desktop-online");
  await page.getByRole("button", { name: m.pos.sell.completeSale, exact: true }).click();
  await until(
    async () => (await api("pos.sales.get", { saleId: draft.id })).status === "COMPLETED",
    "UI checkout did not complete",
  );
  const completed = await api("pos.sales.get", { saleId: draft.id });
  assert.equal(completed.saleChannel, "ONLINE");
  assert.equal(completed.totalKgs, 100);
  checks.push(
    "Desktop: one click, no toggle request, retained scanner focus, reload, real completed online sale",
  );
  const nextDraft = await api(
    "pos.sales.createDraft",
    { registerId: register.id, requireNewDraft: true, lines: [{ productId: product.id, qty: 1 }] },
    true,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + `/pos/sell?registerId=${register.id}`);
  await page.getByTestId("pos-cart-line").first().waitFor();
  await checkbox.waitFor();
  assert.equal(await checkbox.isChecked(), false);
  await capture("pos-mobile-in-store");
  await checkbox.click();
  await page.getByRole("button", { name: m.pos.sell.mobile.payment, exact: true }).click();
  const hold = page.getByRole("button", { name: m.pos.sell.holdReceipt, exact: true });
  await hold.click();
  await until(
    async () => Boolean((await api("pos.sales.get", { saleId: nextDraft.id })).isHeld),
    "UI hold did not save",
  );
  assert.equal((await api("pos.sales.get", { saleId: nextDraft.id })).saleChannel, "ONLINE");
  await api("pos.sales.resumeHeldDraft", { saleId: nextDraft.id, registerId: register.id }, true);
  await page.reload();
  await page.getByTestId("pos-cart-line").first().waitFor();
  await checkbox.waitFor();
  await until(() => checkbox.isChecked(), "Resumed online choice not restored");
  await capture("pos-mobile-online");
  await page.getByRole("button", { name: m.pos.sell.mobile.payment, exact: true }).click();
  await page.getByRole("button", { name: m.pos.sell.completeSale, exact: true }).click();
  await until(
    async () => (await api("pos.sales.get", { saleId: nextDraft.id })).status === "COMPLETED",
    "Mobile checkout did not complete",
  );
  assert.equal((await api("pos.sales.get", { saleId: nextDraft.id })).saleChannel, "ONLINE");
  checks.push(
    "Mobile: fresh-sale default, online checkbox, unchanged payment flow, completed sale",
  );
  const target = await api(
    "stores.create",
    {
      name: `QA recipient ${stamp}`,
      code: `QA${stamp}`,
      allowNegativeStock: false,
      trackExpiryLots: false,
    },
    true,
  );
  const own = await api(
    "products.create",
    {
      idempotencyKey: crypto.randomUUID(),
      storeId: target.id,
      name: `Recipient own ${stamp}`,
      baseUnitId: products.baseUnitId,
      basePriceKgs: 70,
    },
    true,
  );
  await page.goto(base + "/settings/store-groups");
  await page.getByRole("heading", { name: m.assortments.title, exact: true }).waitFor();
  await page.getByRole("combobox", { name: m.assortments.source, exact: true }).click();
  const stores = await api("stores.list", undefined);
  await page
    .getByRole("option", {
      name: stores.find((s: { id: string }) => s.id === f.storeId).name,
      exact: true,
    })
    .click();
  await page.getByRole("checkbox", { name: target.name, exact: true }).check();
  await page.getByRole("button", { name: m.assortments.preview, exact: true }).click();
  await page.getByRole("button", { name: m.assortments.apply, exact: true }).waitFor();
  await capture("assortment-mobile-preview");
  await page.getByRole("button", { name: m.assortments.apply, exact: true }).click();
  await until(
    async () =>
      (await api("stores.assortmentOverview", undefined)).rules.some(
        (r: { sourceStoreId: string; targetStoreId: string }) =>
          r.sourceStoreId === f.storeId && r.targetStoreId === target.id,
      ),
    "Rule not applied",
  );
  const targetProducts = await api("products.list", { storeId: target.id, page: 1, pageSize: 100 });
  assert.ok(targetProducts.items.some((p: { id: string }) => p.id === own.id));
  assert.ok(targetProducts.items.some((p: { id: string }) => p.id === product.id));
  const newOwn = await api(
    "products.create",
    {
      idempotencyKey: crypto.randomUUID(),
      storeId: target.id,
      name: `Private future ${stamp}`,
      baseUnitId: products.baseUnitId,
    },
    true,
  );
  const sourceProducts = await api("products.list", {
    storeId: f.storeId,
    search: newOwn.name,
    page: 1,
    pageSize: 25,
  });
  assert.equal(sourceProducts.items.length, 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await capture("assortment-desktop");
  checks.push(
    "Store UI: directional preview/apply, mobile layout, existing products retained, future recipient products private",
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(
    `${out}/failure.txt`,
    await page
      .locator("body")
      .innerText()
      .catch(() => ""),
  );
  throw error;
} finally {
  await writeFile(`${out}/checks.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
