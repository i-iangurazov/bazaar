import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type BrowserContext, type Page, type Locator } from "playwright";
import { verifyProductTable } from "./product-table-check";
const base = process.env.UX_HTTPS === "1" ? "https://localhost:3122" : "http://localhost:3122";
const f = JSON.parse(await readFile("artifacts/ux/fixture.json", "utf8"));
const directory = "artifacts/ux/flows";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
const checks: string[] = [];
const errors: string[] = [];
const record = (name: string) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
async function until(check: () => Promise<boolean>, message: string, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
async function api(context: BrowserContext, name: string, input: unknown, mutation = false) {
  const response = mutation
    ? await context.request.post(`${base}/api/trpc/${name}`, { data: { json: input } })
    : await context.request.get(
        `${base}/api/trpc/${name}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
      );
  const result = await response.json();
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.result.data.json;
}
async function login(role: string, touch = false) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    hasTouch: touch,
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ru", url: base }]);
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
  );
  const { csrfToken } = await (await context.request.get(base + "/api/auth/csrf")).json();
  await context.request.post(base + "/api/auth/callback/credentials", {
    form: {
      csrfToken,
      email: `${role}@test.local`,
      password: "BazaarUxTest123!",
      json: "true",
      callbackUrl: base,
    },
  });
  const session = await (await context.request.get(base + "/api/auth/session")).json();
  assert.equal(
    session.user?.role,
    role.toUpperCase(),
    "Browser checks require a real authenticated session",
  );
  return context;
}
async function open(context: BrowserContext, path: string) {
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", async (response) => {
    if (response.url().includes("inventory.setOnHand") && !response.ok())
      console.log("Inventory rejection", response.status());
  });
  await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator("main").first().waitFor();
  return page;
}
async function readyList(page: Page) {
  await page.locator("[data-list-toolbar]").waitFor();
  await until(
    async () => (await page.locator("[data-list-toolbar]").getAttribute("aria-busy")) !== "true",
    "List did not finish loading",
  );
}
async function clearOfBaam(page: Page, action: Locator) {
  await until(async () => {
    const button = await action.boundingBox();
    const launcher = await page.locator("[data-baam-launcher]").boundingBox();
    return Boolean(
      button &&
      launcher &&
      (button.x + button.width <= launcher.x ||
        launcher.x + launcher.width <= button.x ||
        button.y + button.height <= launcher.y ||
        launcher.y + launcher.height <= button.y),
    );
  }, "BAAM covered an essential action");
}
async function stock(context: BrowserContext) {
  const data = await api(context, "inventory.list", {
    storeId: f.storeId,
    search: f.products[0].sku,
  });
  return data.items.find(
    (item: { snapshot: { productId: string; variantId: string | null } }) =>
      item.snapshot.productId === f.productId && !item.snapshot.variantId,
  ).snapshot;
}
const stockCell = (page: Page) =>
  page.locator(`[data-inline-cell="products:${f.storeId}:${f.productId}:onHand"]:visible`);
const stockEditor = (page: Page) =>
  page.getByRole("textbox", { name: "Редактирование поля: В наличии", exact: true });
async function editStock(page: Page, amount: string) {
  await stockCell(page).dblclick();
  await stockEditor(page).fill(amount);
}
async function commitStock(page: Page) {
  await stockEditor(page).press("Enter");
  await stockEditor(page).waitFor({ state: "hidden" });
}
let failure: string | undefined;
try {
  const admin = await login("admin");
  const tablePage = await admin.newPage();
  await verifyProductTable(tablePage, base, f.storeId, `${directory}/product-table`);
  await tablePage.close();
  record("Product card has one contour; table scroll, row menus and pagination work at four widths");
  for (const path of ["/stores", "/suppliers"]) {
    const formPage = await admin.newPage();
    let releaseSession!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    await formPage.route("**/api/auth/session", async (route) => {
      await gate;
      await route.continue();
    });
    await formPage.goto(`${base}${path}?create=1`);
    await formPage.locator("[data-baam-launcher]").waitFor();
    assert.equal(
      new URL(formPage.url()).searchParams.get("create"),
      "1",
      "Creation shortcut was consumed before the user's role resolved",
    );
    assert.equal(await formPage.getByRole("dialog").count(), 0);
    releaseSession();
    const dialog = formPage.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(
      await dialog.evaluate((element) => element.contains(document.activeElement)),
      true,
    );
    await formPage.screenshot({ path: `${directory}/${path.slice(1)}-create-shortcut.png` });
    await formPage.unroute("**/api/auth/session");
    await formPage.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await formPage.close();
  }
  record("Store and supplier creation shortcuts wait for the session and open focused forms");
  const dashboard = await open(admin, `/dashboard?storeId=${f.storeId}`);
  await dashboard.locator('[data-dashboard-kpi="sales"]').waitFor({ timeout: 90_000 });
  assert.equal(await dashboard.locator("[data-dashboard-kpi]").count(), 4);
  const business = await api(admin, "dashboard.bootstrap", {
    storeId: f.storeId,
    includeRecentActivity: false,
    includeRecentMovements: false,
  });
  assert.equal(business.summary.business.todaySalesKgs, 217);
  assert.match(await dashboard.locator('[data-dashboard-kpi="sales"]').innerText(), /217/);
  assert.match(await dashboard.locator('[data-dashboard-kpi="receipts"]').innerText(), /1/);
  const attention = dashboard
    .locator('a[href*="/products?"][href*="readiness=missingPrice"]')
    .first();
  await attention.click();
  await readyList(dashboard);
  assert.equal(new URL(dashboard.url()).searchParams.get("storeId"), f.storeId);
  assert.equal(new URL(dashboard.url()).searchParams.get("readiness"), "missingPrice");
  await until(
    async () => (await dashboard.locator("[data-filter-summary]").innerText()).includes("Нет цены"),
    "Deep link failed: " + dashboard.url(),
  );
  record("Dashboard uses actual daily totals and opens the matching store/filter");
  await dashboard.getByRole("button", { name: "Сбросить фильтры", exact: true }).first().click();
  await until(
    async () => new URL(dashboard.url()).searchParams.get("readiness") === "all",
    "Deep-linked filter could not be cleared",
  );
  await dashboard.locator("#products-search").fill(f.products[0].sku);
  await stockCell(dashboard).waitFor();
  const canonical = new URL(dashboard.url()).search;
  // The live router must see the filter before a document reload. Otherwise
  // return links/router.refresh can restore an older search despite a correct URL.
  const liveEdit = dashboard
    .locator("tr")
    .filter({ has: stockCell(dashboard) })
    .getByRole("link", { name: "Редактировать", exact: true });
  await until(async () => {
    const href = new URL((await liveEdit.getAttribute("href"))!, base);
    return href.searchParams.get("returnTo") === `/products${canonical}`;
  }, "Router did not synchronize the live list filters");
  await dashboard.reload();
  await stockCell(dashboard).waitFor();
  assert.equal(await dashboard.locator("#products-search").inputValue(), f.products[0].sku);
  const row = dashboard.locator("tr").filter({ has: stockCell(dashboard) });
  const editLink = row.getByRole("link", { name: "Редактировать", exact: true });
  assert.notEqual(await editLink.getAttribute("target"), "_blank");
  await editLink.click();
  await dashboard.waitForURL(`**/products/${f.productId}*`);
  await dashboard.goBack();
  await stockCell(dashboard).waitFor();
  assert.equal(new URL(dashboard.url()).search, canonical);
  record("Search/store survive reload, same-tab edit and browser Back");
  await dashboard.locator("#products-search").fill("nothing-matches-ux-1974");
  await dashboard.getByText("По этим условиям ничего не найдено", { exact: true }).waitFor();
  await dashboard.screenshot({ path: `${directory}/filtered-empty.png` });
  assert.equal(
    await dashboard.locator('main a[href^="/products/new"]').count(),
    1,
    "Filtered empty state must offer reset instead of duplicate creation prompts",
  );
  await dashboard.getByRole("button", { name: "Сбросить фильтры", exact: true }).first().click();
  await readyList(dashboard);
  await dashboard.getByRole("button", { name: "Следующая страница", exact: true }).click();
  await until(
    async () => new URL(dashboard.url()).searchParams.get("page") === "2",
    "Pagination did not update URL",
  );
  await dashboard.reload();
  await readyList(dashboard);
  assert.equal(new URL(dashboard.url()).searchParams.get("page"), "2");
  record("Filtered empty/reset and page restoration work");
  await dashboard.goto(`${base}/products?storeId=${f.storeId}&readiness=missingPrice&pageSize=1`);
  await readyList(dashboard);
  const matching = await api(admin, "products.listIds", {
    storeId: f.storeId,
    readiness: "missingPrice",
  });
  assert.ok(matching.length > 1 && matching.length < 144);
  await dashboard
    .getByRole("checkbox", { name: "Выбрать записи на этой странице", exact: true })
    .check();
  const selection = dashboard.locator('[data-component="selection-toolbar"]');
  assert.equal(await selection.getAttribute("data-count"), "1");
  await selection.getByRole("button", { name: /Выбрать все/ }).click();
  await until(
    async () => (await selection.getAttribute("data-count")) === String(matching.length),
    "All-result selection ignored readiness",
  );
  await dashboard.locator("#products-search").fill("nothing-matches-selection");
  await selection.waitFor({ state: "hidden" });
  await dashboard.goto(`${base}/products?storeId=${f.storeId}&readiness=missingPrice&pageSize=1`);
  await readyList(dashboard);
  let releaseSelection!: () => void;
  let selectionRequested = false;
  const selectionGate = new Promise<void>((resolve) => {
    releaseSelection = resolve;
  });
  await dashboard.route("**/api/trpc/products.listIds*", async (route) => {
    selectionRequested = true;
    await selectionGate;
    await route.continue();
  });
  await dashboard
    .getByRole("checkbox", { name: "Выбрать записи на этой странице", exact: true })
    .check();
  await selection.getByRole("button", { name: /Выбрать все/ }).click();
  await until(async () => selectionRequested, "Select-all request did not start");
  await dashboard.locator("#products-search").fill("nothing-matches-selection");
  releaseSelection();
  await dashboard.waitForTimeout(700);
  assert.equal(await selection.count(), 0, "Late selection response restored hidden records");
  await dashboard.unroute("**/api/trpc/products.listIds*");
  await dashboard.goto(`${base}/products?storeId=${f.storeId}`);
  await readyList(dashboard);
  record(
    "Bulk selection is limited to filtered results and late responses cannot select hidden records",
  );
  await dashboard.locator("#products-search").fill(f.products[0].sku);
  await stockCell(dashboard).waitFor();
  const initial = await stock(admin);
  await stockCell(dashboard).focus();
  await stockCell(dashboard).press("Enter");
  await stockEditor(dashboard).fill("987");
  await stockEditor(dashboard).press("Escape");
  await until(
    async () => await stockCell(dashboard).evaluate((el) => document.activeElement === el),
    "Keyboard focus was not restored",
  );
  assert.equal((await stock(admin)).onHand, initial.onHand);
  let writes = 0;
  await dashboard.route("**/api/trpc/inventory.setOnHand*", async (route) => {
    writes++;
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });
  await editStock(dashboard, "0");
  await stockEditor(dashboard).press("Enter");
  await dashboard.getByRole("heading", { name: "Товары", exact: true }).first().click();
  await stockEditor(dashboard).waitFor({ state: "hidden" });
  assert.equal(writes, 1);
  assert.equal((await stock(admin)).onHand, 0);
  record("Double-click zero + slow response + Enter/blur save once; keyboard Escape cancels");
  await dashboard.unroute("**/api/trpc/inventory.setOnHand*");
  const manager = await login("manager");
  const second = await open(manager, `/products?storeId=${f.storeId}&q=${f.products[0].sku}`);
  await stockCell(second).waitFor();
  await editStock(dashboard, "19");
  await editStock(second, "3");
  await commitStock(second);
  const conflict = dashboard.waitForResponse(
    (response) => response.url().includes("inventory.setOnHand") && response.status() === 409,
  );
  await stockEditor(dashboard).press("Enter");
  await conflict;
  await stockEditor(dashboard).waitFor({ state: "hidden" });
  assert.equal((await stock(admin)).onHand, 3);
  await dashboard.screenshot({ path: `${directory}/stock-conflict.png` });
  record("Two browser sessions cannot silently overwrite a concurrent stock edit");
  let disconnected = true;
  await dashboard.route("**/api/trpc/inventory.setOnHand*", (route) => {
    if (disconnected) {
      disconnected = false;
      return route.abort("internetdisconnected");
    }
    return route.continue();
  });
  await dashboard.reload();
  await stockCell(dashboard).waitFor();
  await editStock(dashboard, String(initial.onHand + 2));
  await stockEditor(dashboard).press("Enter");
  await until(
    async () => !disconnected && (await stockEditor(dashboard).getAttribute("readonly")) === null,
    "Failed request stayed busy",
  );
  assert.equal((await stock(admin)).onHand, 3);
  assert.equal(await stockEditor(dashboard).inputValue(), String(initial.onHand + 2));
  await commitStock(dashboard);
  assert.equal((await stock(admin)).onHand, initial.onHand + 2);
  await editStock(dashboard, String(initial.onHand));
  await commitStock(dashboard);
  assert.equal((await stock(admin)).onHand, initial.onHand);
  record(
    "Network failure retains input; retry uses normal inventory service and restores fixture quantity",
  );
  await dashboard.goto(`${base}/inventory?storeId=${f.storeId}&stockFilter=negativeStock`);
  await readyList(dashboard);
  await until(
    async () =>
      (await dashboard.locator("[data-inventory-page-summary]").innerText()).includes(
        "отрицательных — 1",
      ),
    "Scoped inventory page summary did not load",
  );
  assert.equal(await dashboard.locator("#inventory-stock").innerText(), "Отрицательный остаток");
  await dashboard.screenshot({ path: `${directory}/active-inventory-filter.png` });
  record("Inventory filter deep link and explicitly page-scoped summaries agree");
  const productName = `UI form ${randomUUID().slice(0, 8)}`;
  const returnTo = `/products?storeId=${f.otherStoreId}&q=${encodeURIComponent(productName)}`;
  await dashboard.goto(
    `${base}/products/new?storeId=${f.otherStoreId}&returnTo=${encodeURIComponent(returnTo)}`,
  );
  const nameInput = dashboard.getByRole("textbox", { name: /^Название/ }).first();
  await nameInput.fill(productName);
  await dashboard.getByLabel("Цена продажи", { exact: true }).first().fill("19");
  let createRequests = 0;
  await dashboard.route("**/api/trpc/products.create*", async (route) => {
    createRequests++;
    if (createRequests === 1) return route.abort("internetdisconnected");
    await route.continue();
  });
  const save = dashboard.getByRole("button", { name: "Сохранить", exact: true });
  await save.click();
  await until(
    async () => createRequests === 1 && (await save.isEnabled()),
    "Product form did not recover after network error",
  );
  assert.equal(await nameInput.inputValue(), productName);
  await dashboard.screenshot({
    path: `${directory}/product-form-network-error.png`,
    fullPage: true,
  });
  await save.click();
  await dashboard.waitForURL((url) => url.pathname === "/products");
  await readyList(dashboard);
  assert.equal(new URL(dashboard.url()).searchParams.get("storeId"), f.otherStoreId);
  assert.equal(new URL(dashboard.url()).searchParams.get("q"), productName);
  const created = await api(admin, "products.listIds", {
    storeId: f.otherStoreId,
    search: productName,
  });
  assert.equal(created.length, 1, "Product retry created duplicates or lost selected store");
  assert.equal(createRequests, 2);
  record(
    "Product form retains values on network failure; retry creates one product and restores list context",
  );
  await dashboard.goto(`${base}/pos?store=${f.otherStoreId}`);
  await dashboard.locator("#pos-entry-store").waitFor();
  await until(
    async () => (await dashboard.locator("#pos-entry-store").innerText()).includes("Ош"),
    "POS store context did not load",
  );
  assert.equal(
    await dashboard.locator('main a[href*="/pos/sell"]').count(),
    0,
    "POS silently selected a register from another store",
  );
  record("POS respects the requested store when its register list is empty");
  await dashboard.goto(`${base}/inventory/receiving?storeId=${f.otherStoreId}`);
  await dashboard.getByRole("combobox", { name: "Магазин", exact: true }).waitFor();
  await dashboard.getByRole("textbox", { name: "Найти товар", exact: true }).fill(productName);
  await dashboard
    .locator(".bazaar-doc-search-row button")
    .filter({ hasText: productName })
    .first()
    .click();
  await dashboard.locator('[data-receiving-input="quantity"]').fill("5");
  await dashboard.locator('[data-receiving-input="unitCost"]').fill("0");
  await clearOfBaam(
    dashboard,
    dashboard.getByRole("button", { name: "Провести оприходование", exact: true }),
  );
  await dashboard.screenshot({ path: `${directory}/receiving-ready.png`, fullPage: true });
  await dashboard.getByRole("button", { name: "Провести оприходование", exact: true }).click();
  await dashboard.waitForURL("**/inventory/movements/**");
  const quantity = async (storeId: string) => {
    const data = await api(admin, "inventory.list", { storeId, search: productName });
    return data.items.find(
      (item: { snapshot: { productId: string } }) => item.snapshot.productId === created[0],
    )?.snapshot.onHand;
  };
  assert.equal(await quantity(f.otherStoreId), 5);
  await dashboard.goto(
    `${base}/inventory/transfers?fromStoreId=${f.otherStoreId}&toStoreId=${f.emptyStoreId}`,
  );
  await dashboard.getByRole("combobox", { name: "Куда", exact: true }).click();
  await dashboard.getByRole("option", { name: "Новый магазин", exact: true }).click();
  await dashboard
    .getByRole("textbox", { name: "Найти товар в источнике", exact: true })
    .fill(productName);
  await dashboard
    .locator(".bazaar-doc-search-row button")
    .filter({ hasText: productName })
    .first()
    .click();
  await dashboard.locator('[data-transfer-input="quantity"]').fill("2");
  await dashboard.getByRole("button", { name: "Провести перемещение", exact: true }).click();
  await dashboard.waitForURL("**/inventory/movements/**");
  assert.equal(await quantity(f.otherStoreId), 3);
  assert.equal(await quantity(f.emptyStoreId), 2);
  await dashboard.screenshot({ path: `${directory}/transfer-result.png`, fullPage: true });
  record(
    "Normal receiving accepts zero cost; transfer opens its document and agrees with both stores",
  );
  // Register setup uses the normal authenticated service; the sale itself is entered in the UI.
  const register = await api(
    admin,
    "pos.registers.create",
    { storeId: f.emptyStoreId, name: productName, code: randomUUID().slice(0, 8) },
    true,
  );
  await api(
    admin,
    "pos.shifts.open",
    { registerId: register.id, openingCashKgs: 0, idempotencyKey: randomUUID() },
    true,
  );
  await dashboard.goto(`${base}/pos/sell?registerId=${register.id}`);
  await dashboard
    .getByRole("combobox", { name: "Поиск по названию, SKU или штрихкоду", exact: true })
    .fill(productName);
  await dashboard
    .locator(`[data-product-id="${created[0]}"]`)
    .getByRole("button", { name: "Добавить", exact: true })
    .click();
  const complete = dashboard.getByRole("button", { name: "Завершить продажу", exact: true });
  await complete.waitFor();
  await until(() => complete.isEnabled(), "Checkout is not ready");
  assert.equal(await dashboard.locator("[data-baam-launcher], [data-baam-drawer]").count(), 0);
  await dashboard.screenshot({ path: `${directory}/pos-checkout.png` });
  await complete.click();
  await until(
    async () => (await quantity(f.emptyStoreId)) === 1,
    "POS sale did not reach the normal stock ledger",
  );
  await dashboard
    .getByText(/Продажа.*завершена/)
    .filter({ visible: true })
    .first()
    .waitFor();
  record(
    "POS browser sale completes through the existing payment/stock process in the isolated store",
  );
  for (const [role, context] of [
    ["admin", admin],
    ["manager", manager],
  ] as const) {
    for (const path of ["/inventory", "/pos"]) {
      const p = await open(context, path);
      await p.getByRole("button", { name: /BAAM/ }).first().waitFor();
      await p.close();
    }
    record(`${role}: BAAM remains accessible on Inventory and POS`);
  }
  for (const role of ["staff", "cashier"]) {
    const context = await login(role);
    const p = await open(context, "/pos");
    await p.getByRole("heading").first().waitFor();
    assert.equal(await p.getByRole("button", { name: /BAAM/ }).count(), 0);
    const forbidden = await context.request.get(
      `${base}/api/trpc/dashboard.bootstrap?input=${encodeURIComponent(JSON.stringify({ json: { storeId: f.storeId } }))}`,
    );
    assert.equal(forbidden.status(), 403);
    await p.goto(base + "/inventory");
    await p.waitForURL("**/pos*");
    if (role === "cashier") {
      await p.goto(base + `/products?storeId=${f.storeId}&q=${f.products[0].sku}`);
      await stockCell(p).waitFor();
      await stockCell(p).dblclick();
      assert.equal(await stockEditor(p).count(), 0);
    }
    await context.close();
    record(`${role}: role boundaries and read-only cells preserved`);
  }
  await second.close();
  await manager.close();
  await dashboard.setViewportSize({ width: 390, height: 844 });
  await dashboard.goto(`${base}/products?storeId=${f.storeId}`);
  await readyList(dashboard);
  const dockedAssistant = dashboard.locator("[data-baam-mobile-slot] [data-baam-launcher]");
  await dockedAssistant.waitFor();
  await dashboard.evaluate(() => window.scrollTo(0, 500));
  await until(async () => {
    const box = await dockedAssistant.boundingBox();
    return Boolean(box && box.y >= 0 && box.y < 100);
  }, "Mobile assistant must remain in the header while the list scrolls");
  await dashboard.evaluate(() => window.scrollTo(0, 0));
  const viewOptions = dashboard.getByRole("button", { name: "Вид списка", exact: true });
  await viewOptions.click();
  await dashboard.getByRole("button", { name: "Сохранить вид", exact: true }).waitFor();
  await viewOptions.click();
  const more = dashboard
    .locator("[data-native-bottom-nav]")
    .getByRole("button", { name: "Ещё", exact: true });
  await more.click();
  const menu = dashboard.getByRole("dialog");
  await menu.waitFor();
  assert.equal(await menu.evaluate((element) => element.contains(document.activeElement)), true);
  await dashboard.screenshot({ path: `${directory}/mobile-menu.png` });
  await dashboard.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  await until(
    async () => more.evaluate((element) => element === document.activeElement),
    "Mobile menu lost trigger focus",
  );
  await dashboard.locator("[data-baam-launcher]").click();
  await dashboard.locator("[data-baam-chat]").waitFor();
  await dashboard.screenshot({ path: `${directory}/mobile-baam.png` });
  await dashboard.keyboard.press("Escape");
  record("Mobile list options, modal menu focus/Escape and BAAM remain usable");
  await dashboard.setViewportSize({ width: 1440, height: 1000 });
  let dashboardFailures = 0;
  const dashboardEndpoint = "**/api/trpc/*dashboard.bootstrap*";
  await dashboard.route(dashboardEndpoint, (route) => {
    dashboardFailures += 1;
    return route.abort("failed");
  });
  await dashboard.goto(`${base}/dashboard?storeId=${f.storeId}`);
  const retry = dashboard.getByRole("button", { name: "Повторить", exact: true });
  await retry.waitFor({ timeout: 60_000 });
  assert.equal(
    await dashboard.locator("[data-dashboard-kpi]").count(),
    0,
    "Failure was presented as zero data",
  );
  await dashboard.screenshot({ path: `${directory}/dashboard-error.png` });
  assert.ok(dashboardFailures > 0, "The request failure was not injected");
  await dashboard.unroute(dashboardEndpoint);
  await retry.click();
  await dashboard.locator("[data-dashboard-kpi]").first().waitFor();
  record("Dashboard distinguishes a failed request from zero data and recovers with retry");
  await dashboard.goto(`${base}/inventory/movements?storeId=${f.storeId}`);
  const dateHeader = dashboard.getByRole("columnheader", { name: "Дата", exact: true });
  await dateHeader.waitFor();
  for (const direction of ["ascending", "descending", "ascending", "descending"]) {
    await dateHeader.getByRole("button").click();
    await until(
      async () => (await dateHeader.getAttribute("aria-sort")) === direction,
      `Document sorting did not switch to ${direction}`,
    );
  }
  await dashboard.screenshot({ path: `${directory}/movements-sorting.png` });
  record("Document journal sorting switches both directions repeatedly without losing its store");
  for (const [path, procedure, selector] of [
    ["/customers", "customers.list", "#customer-search"],
    ["/purchase-orders", "purchaseOrders.list", 'input[type="search"]'],
    ["/sales/orders", "salesOrders.list", 'input[type="search"]'],
  ]) {
    await dashboard.goto(base + path);
    const search = dashboard.locator(selector);
    await search.waitFor();
    const query = "no-matches-router-regression";
    const filtered = dashboard.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.includes(procedure) && (url.searchParams.get("input") ?? "").includes(query)
      );
    });
    await search.fill(query);
    assert.equal((await filtered).status(), 200);
    assert.equal(await search.inputValue(), query);
    assert.equal(new URL(dashboard.url()).searchParams.get("search"), query);
    await dashboard.reload();
    await search.waitFor();
    assert.equal(await search.inputValue(), query);
  }
  record(
    "Customer, purchase and sales order search updates server results immediately and survives reload",
  );
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
  console.error(failure);
  for (const [index, context] of browser.contexts().entries())
    for (const page of context.pages()) {
      console.log(
        "Failure page",
        page.url(),
        (await page.locator("body").innerText()).slice(-2500),
      );
      await page.screenshot({ path: `${directory}/failure-${index}.png` });
    }
  process.exitCode = 1;
} finally {
  await writeFile(`${directory}/report.json`, JSON.stringify({ checks, errors, failure }, null, 2));
  await browser.close();
}
