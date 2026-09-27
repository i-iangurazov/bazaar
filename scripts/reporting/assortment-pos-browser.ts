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
  const stores = await api("stores.list", undefined);
  for (let index = stores.length; index < 10; index++)
    await api(
      "stores.create",
      {
        name: `Учебный магазин ${index + 1}`,
        code: `S${stamp}${index}`,
        allowNegativeStock: false,
        trackExpiryLots: false,
      },
      true,
    );
  await page.goto(base + "/settings/store-groups");
  await page.getByRole("heading", { name: m.catalogSources.title, exact: true }).waitFor();
  await page
    .getByRole("combobox", { name: m.catalogSources.store, exact: true })
    .selectOption(target.id);
  await page.getByRole("button", { name: m.catalogSources.addSource, exact: true }).click();
  const source = (await api("stores.catalogSettings", { storeId: target.id })).sources.find(
    (s: { key: string }) => s.key === `store:${f.storeId}`,
  );
  assert.ok(source);
  const addDialog = page.getByRole("dialog", { name: m.catalogSources.addSource });
  await addDialog
    .getByText(source.name, { exact: true })
    .locator("..")
    .locator("..")
    .getByRole("button", { name: m.catalogSources.add, exact: true })
    .click();
  const save = page.getByRole("button", { name: m.catalogSources.save, exact: true });
  await until(() => save.isEnabled(), "Server preview did not arrive");
  await capture("assortment-mobile-preview");
  assert.equal(
    (await api("stores.catalogSettings", { storeId: target.id })).settings.connections.some(
      (c: { key: string }) => c.key === source.key,
    ),
    false,
  );
  await page
    .getByRole("combobox", { name: m.catalogSources.store, exact: true })
    .selectOption(f.storeId);
  const unsaved = page.getByRole("dialog", { name: m.catalogSources.unsavedTitle });
  await unsaved.waitFor();
  await unsaved.getByRole("button", { name: m.catalogSources.stay }).click();
  await save.click();
  await page.getByText(m.catalogSources.saved, { exact: true }).waitFor();
  await page.reload();
  // Store choice uses the native selector on mobile; it remains explicit after reload.
  await page
    .getByRole("combobox", { name: m.catalogSources.store, exact: true })
    .selectOption(target.id);
  const sourceSwitch = page.getByRole("switch", {
    name: m.catalogSources.accessLabel.replace("{name}", source.name),
    exact: true,
  });
  await until(
    async () => (await sourceSwitch.getAttribute("aria-checked")) === "true",
    "Saved source did not reload enabled",
  );
  const targetProducts = await api("products.list", { storeId: target.id, page: 1, pageSize: 100 });
  assert.ok(targetProducts.items.some((p: { id: string }) => p.id === own.id));
  assert.ok(targetProducts.items.some((p: { id: string }) => p.id === product.id));
  await api(
    "inventory.adjust",
    {
      storeId: target.id,
      productId: product.id,
      qtyDelta: 4,
      reason: "Isolated source regression",
      idempotencyKey: crypto.randomUUID(),
    },
    true,
  );
  await sourceSwitch.focus();
  await sourceSwitch.press("Space");
  await until(() => save.isEnabled(), "Disable preview did not arrive");
  await page.getByRole("button", { name: m.catalogSources.cancel, exact: true }).click();
  assert.equal(await sourceSwitch.getAttribute("aria-checked"), "true");
  await sourceSwitch.click();
  await until(() => save.isEnabled(), "Disable preview did not arrive");
  // tRPC can batch this mutation with another procedure, in either URL order.
  const saveRequest = /\/api\/trpc\/[^?]*stores\.saveCatalogSettings/;
  await page.route(saveRequest, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "text/plain",
      body: "Injected isolated network failure",
    });
  });
  await save.focus();
  const [failedResponse] = await Promise.all([
    page.waitForResponse((response) => saveRequest.test(response.url()) && response.status() === 503),
    save.press("Enter"),
  ]);
  assert.equal(await failedResponse.text(), "Injected isolated network failure");
  await page
    .getByRole("alert")
    .filter({ has: page.getByRole("button", { name: m.catalogSources.retry, exact: true }) })
    .waitFor();
  await until(() => save.isEnabled(), "Failed save did not restore its draft action");
  assert.equal(await sourceSwitch.getAttribute("aria-checked"), "false");
  assert.equal(
    (await api("stores.catalogSettings", { storeId: target.id })).settings.connections.find(
      (c: { key: string }) => c.key === source.key,
    ).enabled,
    true,
  );
  await page.unroute(saveRequest);
  await save.focus();
  await save.press("Enter");
  await page.getByText(m.catalogSources.saved, { exact: true }).waitFor();
  await page.reload();
  await page
    .getByRole("combobox", { name: m.catalogSources.store, exact: true })
    .selectOption(target.id);
  await until(
    async () => (await sourceSwitch.getAttribute("aria-checked")) === "false",
    "Disabled source did not persist",
  );
  const hidden = await api("products.list", { storeId: target.id, page: 1, pageSize: 100 });
  assert.equal(
    hidden.items.some((p: { id: string }) => p.id === product.id),
    false,
  );
  assert.ok(hidden.items.some((p: { id: string }) => p.id === own.id));
  assert.deepEqual(await api("products.searchQuick", { storeId: target.id, q: `QA-${stamp}` }), []);
  const warehouse = await api("inventory.list", {
    storeId: target.id,
    stockFilter: "notInAssortment",
  });
  assert.equal(
    warehouse.items.find((i: { product: { id: string } }) => i.product.id === product.id).snapshot
      .onHand,
    4,
  );
  await capture("assortment-mobile-disabled");
  await sourceSwitch.click();
  await until(() => save.isEnabled(), "Reconnect preview did not arrive");
  await save.click();
  await page.getByText(m.catalogSources.saved, { exact: true }).waitFor();
  const restored = await api("products.list", { storeId: target.id, page: 1, pageSize: 100 });
  assert.equal(restored.items.filter((p: { id: string }) => p.id === product.id).length, 1);
  // Fixed selection uses the real paginated source browser and bulk search selection.
  await page
    .locator(`[data-source-key="${source.key}"]`)
    .getByRole("button", { name: m.catalogSources.details, exact: true })
    .click();
  let detailDialog = page.getByRole("dialog", { name: source.name, exact: true });
  await detailDialog
    .getByRole("button", { name: m.catalogSources.chooseProducts, exact: true })
    .click();
  await detailDialog
    .getByRole("textbox", { name: m.catalogSources.searchProducts, exact: true })
    .fill(product.name);
  await until(
    async () => (await detailDialog.getByRole("checkbox").count()) === 1,
    "Source search did not narrow selection",
  );
  await detailDialog
    .getByRole("button", { name: m.catalogSources.selectAllMatches, exact: true })
    .click();
  await until(
    async () => await detailDialog.getByRole("checkbox").isChecked(),
    "Bulk selection did not apply",
  );
  await detailDialog.getByRole("button", { name: m.catalogSources.done, exact: true }).click();
  await until(() => save.isEnabled(), "Selection preview did not arrive");
  await save.click();
  await page.getByText(m.catalogSources.saved, { exact: true }).waitFor();
  const fixed = (
    await api("stores.catalogSettings", { storeId: target.id })
  ).settings.connections.find((c: { key: string }) => c.key === source.key);
  assert.equal(fixed.scope, "SELECTED");
  assert.deepEqual(fixed.productIds, [product.id]);
  await page
    .locator(`[data-source-key="${source.key}"]`)
    .getByRole("button", { name: m.catalogSources.details, exact: true })
    .click();
  detailDialog = page.getByRole("dialog", { name: source.name, exact: true });
  await detailDialog
    .getByRole("button", { name: m.catalogSources.fullCatalog, exact: true })
    .click();
  await detailDialog.getByRole("button", { name: m.catalogSources.done, exact: true }).click();
  await until(() => save.isEnabled(), "Full catalogue preview did not arrive");
  await save.click();
  await page.getByText(m.catalogSources.saved, { exact: true }).waitFor();
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
  const actualTotal = (await api("stores.catalogSettings", { storeId: target.id })).total;
  await until(
    async () =>
      Number((await page.getByTestId("assortment-total").innerText()).replace(/\s/g, "")) ===
      actualTotal,
    "Live assortment count did not refresh after creation",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await capture("assortment-desktop");
  // Resolve a legacy source through an explicit reviewed selection in its store panel.
  await page.goto(base + `/settings/store-groups?storeId=${f.storeId}`);
  const legacy = (await api("stores.catalogSettings", { storeId: f.storeId })).sources.find(
    (s: { key: string }) => s.key === `history:${f.storeId}`,
  );
  assert.ok(legacy);
  await page
    .locator(`[data-source-key="${legacy.key}"]`)
    .getByRole("button", { name: m.catalogSources.details, exact: true })
    .click();
  const review = page.getByRole("dialog", { name: legacy.name, exact: true });
  await review.getByRole("button", { name: m.catalogSources.configure, exact: true }).click();
  await review
    .getByRole("textbox", { name: m.catalogSources.searchProducts, exact: true })
    .fill(products.name);
  await until(
    async () => (await review.getByRole("checkbox").count()) === 1,
    "Ownership search did not narrow selection",
  );
  await review.getByRole("checkbox").check();
  await review
    .getByRole("button", { name: m.catalogSources.confirmOwn.replace("{count}", "1"), exact: true })
    .click();
  await until(() => save.isEnabled(), "Ownership preview did not arrive");
  await capture("assortment-ownership-preview");
  await save.click();
  await page.getByText(m.catalogSources.saved, { exact: true }).waitFor();
  assert.ok(
    (await api("products.list", { storeId: target.id, page: 1, pageSize: 100 })).items.some(
      (p: { id: string }) => p.id === f.teaId,
    ),
  );
  await page.goto(base + "/settings/profile");
  const themes = m.profile.preferences.themes;
  const theme = page
    .getByRole("combobox")
    .filter({ hasText: new RegExp(`${themes.light}|${themes.dark}`) });
  await theme.click();
  await page.getByRole("option", { name: themes.light, exact: true }).click();
  await until(
    async () =>
      (await (await context.request.get(base + "/api/auth/session")).json()).user
        .themePreference === "LIGHT",
    "Light theme did not persist in the session",
  );
  await page.goto(base + `/settings/store-groups?storeId=${target.id}`);
  await page.getByTestId("assortment-total").waitFor();
  await until(
    async () => await page.evaluate(() => !document.documentElement.classList.contains("dark")),
    "Light theme did not survive navigation",
  );
  await capture("assortment-desktop-light");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("assortment-mobile-light");
  checks.push(
    "Store UI: recipient selection, keyboard toggle, server preview, cancel/unsaved warning, failed-save recovery, disable/reload/reconnect, warehouse retention, fixed/full selection, private future recipient products, live count, reviewed legacy ownership, light theme",
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
