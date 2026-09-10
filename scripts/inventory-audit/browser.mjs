import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const base = "http://localhost:3119";
const dir = "artifacts/bazaar-stock-audit";
const fixture = JSON.parse(await fs.readFile(`${dir}/fixture.json`, "utf8"));
const evidence = { checks: [], errors: [] };
const record = async (name, details = {}) => {
  evidence.checks.push({ name, ...details, result: "PASS" });
  await fs.writeFile(`${dir}/browser.json`, JSON.stringify(evidence, null, 2));
  console.log(name);
};
const browser = await chromium.launch({
  headless: true,
  ...(process.env.QA_BROWSER_CHANNEL ? { channel: process.env.QA_BROWSER_CHANNEL } : {}),
});
const contexts = [];
async function api(context, route, input, mutation = false) {
  const response = mutation
    ? await context.request.post(`${base}/api/trpc/${route}`, { data: { json: input } })
    : await context.request.get(
        `${base}/api/trpc/${route}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
      );
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result.data.json;
}
async function login(email, hasTouch = false) {
  const context = await browser.newContext({ hasTouch, viewport: { width: 1440, height: 1000 } });
  contexts.push(context);
  // No external site, pixel, payment or fiscal provider is allowed from the test browser.
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === base ? route.continue() : route.abort();
  });
  const csrf = await (await context.request.get(`${base}/api/auth/csrf`)).json();
  await context.request.post(`${base}/api/auth/callback/credentials`, {
    form: {
      csrfToken: csrf.csrfToken,
      email,
      password: "InventoryAudit123!",
      json: "true",
      callbackUrl: base,
    },
  });
  return context;
}
async function openProducts(context) {
  const page = await context.newPage();
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  await page.goto(`${base}/products`);
  const store = page
    .locator('[role="combobox"]:visible')
    .filter({ hasText: /Audit Store B|Test Store/ })
    .first();
  await store.waitFor({ timeout: 60_000 });
  if (!(await store.innerText()).includes("Test Store")) {
    await store.click();
    await page.getByRole("option", { name: "Test Store", exact: true }).click();
  }
  await page.locator('[data-tour="products-search"]:visible').fill("Test Product");
  await page.locator("tr").filter({ hasText: "Test Product" }).waitFor({ timeout: 60_000 });
  return page;
}
const row = (page) => page.locator("tr").filter({ hasText: "Test Product" });
const editor = (page) => row(page).getByRole("textbox", { name: /Редактирование поля: В наличии/ });
const cell = (page) => row(page).locator('[data-inline-cell$=":onHand"]');
async function stock(context) {
  const data = await api(context, "inventory.list", {
    storeId: fixture.storeId,
    search: "Test Product",
  });
  return data.items.find(
    (item) => item.snapshot.productId === fixture.productId && !item.snapshot.variantId,
  ).snapshot;
}
async function edit(page, quantity) {
  await cell(page).dblclick();
  await editor(page).waitFor();
  await editor(page).fill(String(quantity));
}
async function settled(page) {
  await editor(page).waitFor({ state: "hidden", timeout: 30_000 });
  await cell(page).waitFor();
}
try {
  const admin = await login("admin@test.local", true);
  const manager = await login("manager@test.local");
  const initial = await stock(admin);
  await api(
    admin,
    "inventory.setOnHand",
    {
      storeId: fixture.storeId,
      productId: fixture.productId,
      targetOnHand: 12,
      expectedOnHand: initial.onHand,
      expectedVersion: initial.version,
      reason: "Browser fixture baseline",
      idempotencyKey: randomUUID(),
    },
    true,
  );
  const first = await openProducts(admin);
  const second = await openProducts(manager);
  await cell(first).dblclick();
  assert.equal(await editor(first).inputValue(), "12");
  assert.deepEqual(
    await editor(first).evaluate((input) => [
      document.activeElement === input,
      input.selectionStart,
      input.selectionEnd,
    ]),
    [true, 0, 2],
  );
  await editor(first).fill("99");
  await editor(first).press("Escape");
  await settled(first);
  assert.equal((await stock(admin)).onHand, 12);
  await record("Touch-capable Chrome: double-click, focus, select-all, Escape without write");

  let writes = 0;
  let slow = true;
  await first.route("**/api/trpc/inventory.setOnHand*", async (route) => {
    writes += 1;
    if (slow) await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  await edit(first, "0");
  await editor(first).press("Enter");
  await first.getByRole("heading", { name: "Товары", exact: true }).first().click();
  await settled(first);
  assert.equal(writes, 1);
  assert.equal((await stock(admin)).onHand, 0);
  await record("Slow response: Enter plus blur sends one request and saves zero");
  slow = false;
  for (const invalid of ["", "1,5", "abc"]) {
    const previousWrites = writes;
    await edit(first, invalid);
    await editor(first).press("Enter");
    assert.equal(writes, previousWrites);
    await editor(first).press("Escape");
    await settled(first);
  }
  await edit(first, "0");
  await editor(first).press("Enter");
  await settled(first);
  assert.equal(writes, 1);
  await edit(first, "-2");
  await editor(first).press("Tab");
  await settled(first);
  assert.equal((await stock(admin)).onHand, -2);
  await record(
    "Empty/invalid/fractional input rejected; unchanged value sends nothing; negative saved on blur",
  );

  await edit(first, "8");
  await edit(second, "3");
  await editor(second).press("Enter");
  await settled(second);
  // The first session must retain its draft and old revision across the SSE refresh.
  assert.equal(await editor(first).inputValue(), "8");
  await editor(first).press("Enter");
  await settled(first);
  assert.equal((await stock(admin)).onHand, 3);
  await first.getByRole("alert").filter({ hasText: "Остаток уже изменён" }).waitFor();
  await record(
    "Two browser sessions: concurrent absolute change yields explicit conflict, preserves the winner",
  );

  await edit(first, "9");
  const register = await api(
    admin,
    "pos.registers.create",
    { storeId: fixture.storeId, name: "Stock audit register", code: `QA${Date.now()}` },
    true,
  );
  await api(
    manager,
    "pos.shifts.open",
    { registerId: register.id, openingCashKgs: 0, idempotencyKey: randomUUID() },
    true,
  );
  const sale = await api(manager, "pos.sales.createDraft", { registerId: register.id }, true);
  await api(
    manager,
    "pos.sales.addLine",
    { saleId: sale.id, productId: fixture.productId, qty: 5 },
    true,
  );
  assert.equal((await stock(admin)).onHand, 3);
  await api(
    manager,
    "pos.sales.complete",
    {
      saleId: sale.id,
      payments: [{ method: "CASH", amountKgs: 500 }],
      idempotencyKey: randomUUID(),
    },
    true,
  );
  assert.equal((await stock(admin)).onHand, -2);
  await editor(first).press("Enter");
  await settled(first);
  assert.equal((await stock(admin)).onHand, -2);
  await record(
    "Second authenticated session completes isolated POS sale through zero; open stock editor conflicts",
  );

  await first.unroute("**/api/trpc/inventory.setOnHand*");
  const requests = [];
  let loseResponse = true;
  await first.route("**/api/trpc/inventory.setOnHand*", async (route) => {
    requests.push(route.request().postDataJSON());
    if (loseResponse) {
      loseResponse = false;
      await route.fetch(); // commit, then simulate loss of the response
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await edit(first, "7");
  await editor(first).press("Enter");
  await first.getByRole("alert").filter({ hasText: /./ }).last().waitFor();
  // Wait for the refetch after a transport failure and retry the retained operation.
  await first.waitForFunction(() => !document.querySelector("input[readonly]"));
  assert.equal((await stock(admin)).onHand, 7);
  await editor(first).press("Enter");
  await settled(first);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal((await stock(admin)).onHand, 7);
  await record("Lost response after commit: same-key retry succeeds without a second adjustment");

  await first.reload();
  await cell(first).waitFor();
  assert.match(await cell(first).innerText(), /7/);
  const third = await login("admin@test.local");
  const reopened = await openProducts(third);
  assert.match(await cell(reopened).innerText(), /7/);
  await record("Saved stock survives reload and independent login");

  await first.unroute("**/api/trpc/inventory.setOnHand*");
  let disconnected = true;
  await first.route("**/api/trpc/inventory.setOnHand*", (route) => {
    if (disconnected) {
      disconnected = false;
      return route.abort("internetdisconnected");
    }
    return route.continue();
  });
  await edit(first, "8");
  await editor(first).press("Enter");
  await first.waitForFunction(() => !document.querySelector("input[readonly]"));
  assert.equal((await stock(admin)).onHand, 7);
  assert.equal(await editor(first).inputValue(), "8");
  await editor(first).press("Enter");
  await settled(first);
  assert.equal((await stock(admin)).onHand, 8);
  await record(
    "Network failure before commit preserves server stock and draft; retry saves correctly",
  );

  const search = first.locator('[data-tour="products-search"]:visible');
  await search.fill("");
  await first.getByRole("button", { name: "Следующая страница", exact: true }).waitFor();
  const nameSortButton = first
    .getByRole("columnheader")
    .filter({ hasText: "Название" })
    .getByRole("button");
  await nameSortButton.click();
  await nameSortButton.click();
  // Select ascending explicitly: the default sorting can be restored from local storage.
  const nameHeader = first.getByRole("columnheader").filter({ hasText: "Название" });
  if ((await nameHeader.getAttribute("aria-sort")) !== "ascending") await nameSortButton.click();
  assert.equal(await nameHeader.getAttribute("aria-sort"), "ascending");
  assert.equal(new URL(first.url()).searchParams.get("sortBy"), "name");
  assert.equal(new URL(first.url()).searchParams.get("sortDirection"), "asc");
  await first.getByRole("button", { name: "Следующая страница", exact: true }).click();
  await cell(first).waitFor();
  await edit(first, "9");
  await editor(first).press("Enter");
  await settled(first);
  assert.equal((await stock(admin)).onHand, 9);
  await search.fill("Test Product");
  await cell(first).waitFor();
  await cell(first).filter({ hasText: /^9$/ }).waitFor();
  assert.match(await cell(first).innerText(), /9/);
  await record("Sorting, page change and search keep stock edits attached to the correct product");

  await search.fill("Variant Audit");
  const aggregate = first
    .locator("tr")
    .filter({ hasText: "Variant Audit" })
    .locator('[data-inline-cell$=":onHand"]');
  await aggregate.waitFor();
  await aggregate.dblclick();
  assert.equal(
    await first.getByRole("textbox", { name: /Редактирование поля: В наличии/ }).count(),
    0,
  );
  assert.match(await aggregate.getAttribute("title"), /вариант/i);
  const inventory = await admin.newPage();
  inventory.on("pageerror", (error) => evidence.errors.push(error.message));
  await inventory.goto(`${base}/inventory`);
  const inventoryStore = inventory
    .locator('[role="combobox"]:visible')
    .filter({ hasText: /Audit Store B|Test Store/ })
    .first();
  await inventoryStore.waitFor({ timeout: 60_000 });
  if (!(await inventoryStore.innerText()).includes("Test Store")) {
    await inventoryStore.click();
    await inventory.getByRole("option", { name: "Test Store", exact: true }).click();
  }
  const inventorySearch = inventory
    .getByPlaceholder("Поиск по SKU или названию")
    .filter({ visible: true });
  await inventorySearch.waitFor({ timeout: 60_000 });
  await inventorySearch.fill("Variant Audit");
  const blueRow = inventory.locator("tr").filter({ hasText: "Variant Audit • Blue" });
  const blueCell = blueRow.locator('[data-inline-cell$=":onHand"]');
  await blueCell.waitFor({ timeout: 60_000 });
  await blueCell.dblclick();
  const blueEditor = blueRow.getByRole("textbox", { name: /Редактирование поля: В наличии/ });
  await blueEditor.fill("-4");
  await blueEditor.press("Enter");
  await blueEditor.waitFor({ state: "hidden" });
  let variants = await api(admin, "inventory.list", {
    storeId: fixture.storeId,
    search: "Variant Audit",
  });
  assert.equal(
    variants.items.find((item) => item.snapshot.variantId === fixture.variantId).snapshot.onHand,
    -4,
  );
  assert.equal(
    variants.items.find(
      (item) => item.snapshot.productId === fixture.variantProductId && !item.snapshot.variantId,
    ).snapshot.onHand,
    2,
  );
  const detail = await admin.newPage();
  detail.on("pageerror", (error) => evidence.errors.push(error.message));
  await detail.goto(`${base}/products/${fixture.variantProductId}?storeId=${fixture.storeId}`);
  const detailVariantCell = detail.locator(`[data-inline-cell*="${fixture.variantId}"]`).first();
  await detailVariantCell.waitFor({ timeout: 60_000 });
  await detailVariantCell.dblclick();
  const detailEditor = detail.getByRole("textbox", { name: /Редактирование поля: В наличии/ });
  await detailEditor.fill("6");
  await detailEditor.press("Enter");
  await detailEditor.waitFor({ state: "hidden" });
  variants = await api(admin, "inventory.list", {
    storeId: fixture.storeId,
    search: "Variant Audit",
  });
  assert.equal(
    variants.items.find((item) => item.snapshot.variantId === fixture.variantId).snapshot.onHand,
    6,
  );
  assert.equal(
    variants.items.find(
      (item) => item.snapshot.productId === fixture.variantProductId && !item.snapshot.variantId,
    ).snapshot.onHand,
    2,
  );
  await inventory.reload();
  await blueCell.waitFor();
  assert.equal((await blueCell.innerText()).trim(), "6");
  assert.equal(new URL(first.url()).searchParams.get("q"), "Variant Audit");
  await first.reload();
  await aggregate.waitFor();
  assert.match(await aggregate.innerText(), /8/);
  await record(
    "Inventory and product-detail variant editors agree; product total cannot overwrite BASE stock",
  );

  for (const email of ["staff@test.local", "cashier@test.local"]) {
    const limited = await login(email);
    if (email.startsWith("staff")) {
      const denied = await limited.newPage();
      await denied.goto(`${base}/products`);
      await denied
        .getByRole("heading", { name: "Касса", exact: true })
        .waitFor({ timeout: 30_000 });
      assert.equal(await denied.locator('[data-inline-cell$=":onHand"]').count(), 0);
    } else {
      const denied = await openProducts(limited);
      await cell(denied).dblclick();
      assert.equal(await editor(denied).count(), 0);
    }
    const current = await stock(admin);
    await assert.rejects(
      api(
        limited,
        "inventory.setOnHand",
        {
          storeId: fixture.storeId,
          productId: fixture.productId,
          targetOnHand: 100,
          expectedOnHand: current.onHand,
          expectedVersion: current.version,
          reason: "Forbidden role test",
          idempotencyKey: randomUUID(),
        },
        true,
      ),
      /FORBIDDEN/,
    );
  }
  assert.equal((await stock(admin)).onHand, 9);
  await record("STAFF and CASHIER cannot edit stock through either UI or direct authenticated API");
  await first.screenshot({ path: `${dir}/after.png`, fullPage: true });
  assert.deepEqual(evidence.errors, []);
  await record("Browser run complete without uncaught application errors");
} catch (error) {
  evidence.failure = String(error?.stack || error);
  await fs.writeFile(`${dir}/browser.json`, JSON.stringify(evidence, null, 2));
  for (const [index, context] of contexts.entries()) {
    for (const [pageIndex, page] of context.pages().entries()) {
      await fs.writeFile(
        `${dir}/failure-${index}-${pageIndex}.json`,
        JSON.stringify(
          {
            url: page.url(),
            search: await page
              .locator('input[data-tour="products-search"]')
              .inputValue({ timeout: 1000 })
              .catch(() => null),
          },
          null,
          2,
        ),
      );
      await page
        .screenshot({ path: `${dir}/failure-${index}-${pageIndex}.png`, fullPage: true })
        .catch(() => {});
    }
  }
  throw error;
} finally {
  await browser.close();
}
