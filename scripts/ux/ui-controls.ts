import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type Page, type BrowserContext } from "playwright";

const base =
  process.env.UI_CONTROLS_BASE ??
  (process.env.UX_HTTPS === "1" ? "https://localhost:3122" : "http://localhost:3122");
assert.equal(new URL(base).hostname, "localhost", "UI fixtures require the isolated localhost app");
const output = process.env.UI_CONTROLS_OUTPUT ?? "artifacts/ux/controls";
const browser = await chromium.launch();
const fixture = JSON.parse(await readFile("artifacts/ux/fixture.json", "utf8"));
const checks: string[] = [];
const errors: string[] = [];
const observations: unknown[] = [];
await mkdir(output, { recursive: true });
const record = (name: string) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
const messages = Object.fromEntries(
  await Promise.all(
    ["ru", "kg", "en"].map(async (locale) => [
      locale,
      JSON.parse(await readFile(`messages/${locale}.json`, "utf8")),
    ]),
  ),
);
async function login(role: string) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ru", url: base }]);
  const { csrfToken } = await (await context.request.get(base + "/api/auth/csrf")).json();
  await context.request.post(base + "/api/auth/callback/credentials", {
    form: { csrfToken, email: `${role}@test.local`, password: "BazaarUxTest123!", json: "true" },
  });
  assert.equal(
    (await (await context.request.get(base + "/api/auth/session")).json()).user?.role,
    role.toUpperCase(),
  );
  return context;
}
async function api(context: BrowserContext, name: string, input: unknown, mutation = false) {
  const response = mutation
    ? await context.request.post(`${base}/api/trpc/${name}`, { data: { json: input } })
    : await context.request.get(
        `${base}/api/trpc/${name}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
      );
  const result = await response.json();
  if (result.error) throw Error(JSON.stringify(result.error));
  return result.result.data.json;
}
async function ready(page: Page) {
  await page
    .getByText(/Обновлено|Updated|Жаңыртылды/)
    .first()
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
}
async function geometry(page: Page) {
  return page
    .locator("section")
    .first()
    .evaluate((el) =>
      [
        ...el.querySelectorAll(
          'button[role="combobox"],input:not([type="hidden"]),button[role="checkbox"]',
        ),
      ].map((e) => ({ name: e.getAttribute("aria-label"), ...e.getBoundingClientRect().toJSON() })),
    );
}
async function noOverflow(page: Page) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "Document horizontal overflow",
  );
  const launcher = page.locator("[data-baam-launcher]");
  await launcher.waitFor({ state: "visible" });
  assert.equal(await launcher.count(), 1);
  assert.equal(await launcher.evaluate((el) => Boolean(el.closest("header"))), true);
  const box = await launcher.boundingBox();
  assert.ok(
    box && box.x >= 0 && box.x + box.width <= page.viewportSize()!.width + 1,
    "Header launcher outside viewport",
  );
}
async function shot(page: Page, name: string) {
  await noOverflow(page);
  await page.screenshot({ path: `${output}/${name}.png` });
}
async function closeChat(page: Page) {
  await page.keyboard.press("Escape");
  await page.locator("[data-baam-drawer]").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.hasAttribute("data-baam-launcher"));
}
async function openChat(page: Page) {
  await page.locator("[data-baam-launcher]").click();
  await page.locator("[data-baam-drawer] [data-baam-input]").waitFor();
}
let failure: string | undefined;
try {
  const context = await login("admin"),
    page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/admin/metrics");
  await ready(page);
  const first = await geometry(page);
  assert.equal(first[0].y, first[1].y);
  assert.equal(first[1].y, first[2].y);
  for (const field of first.slice(0, 3)) assert.equal(field.height, 40);
  const store = page.getByRole("combobox", { name: "Магазин", exact: true });
  await store.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("listbox").waitFor();
  assert.deepEqual(await geometry(page), first, "Opening dropdown moved controls");
  const target = page.getByRole("option").nth(1),
    targetLabel = (await target.innerText()).trim();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/trpc/*adminMetrics.get*", async (route) => {
    await held;
    await route.continue();
  });
  await target.click();
  await page.waitForURL(/storeId=/);
  assert.equal(
    (await store.innerText()).trim(),
    targetLabel,
    "Selected label disappeared while loading",
  );
  assert.deepEqual(await geometry(page), first, "Selection changed filter geometry");
  const refreshed = page.waitForResponse(
    (response) => response.url().includes("adminMetrics.get") && response.ok(),
  );
  release();
  await refreshed;
  await ready(page);
  await page.unroute("**/api/trpc/*adminMetrics.get*");
  const search = page.getByRole("textbox", { name: "Поиск", exact: true });
  await search.fill("UI");
  await search.blur();
  await page.waitForURL(/search=UI/);
  await ready(page);
  assert.deepEqual(await geometry(page), first, "Search changed filter geometry");
  await page.getByRole("checkbox").first().click();
  await page.waitForURL(/includeArchived=true/);
  await ready(page);
  assert.equal(await page.getByRole("checkbox").first().isChecked(), true);
  await page.reload();
  await ready(page);
  assert.equal((await store.innerText()).trim(), targetLabel);
  assert.equal(await search.inputValue(), "UI");
  await store.click();
  await page.getByRole("option", { name: "Все магазины", exact: true }).click();
  await page.waitForURL((url) => !url.searchParams.has("storeId"));
  await ready(page);
  record(
    "Metrics fields: aligned 40px controls, keyboard, delayed options, search/checkbox/URL/reload/all-stores reset",
  );
  for (const locale of process.env.UI_CONTROLS_FAST ? ["ru"] : ["ru", "kg", "en"]) {
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: base }]);
    for (const theme of process.env.UI_CONTROLS_FAST ? ["light"] : ["light", "dark"]) {
      for (const width of process.env.UI_CONTROLS_FAST ? [1440] : [360, 768, 1440]) {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
        await page.goto(base + "/admin/metrics");
        await ready(page);
        await page.evaluate((theme) => {
          localStorage.setItem("theme", theme);
          document.documentElement.classList.toggle("dark", theme === "dark");
        }, theme);
        await page.evaluate(() => window.scrollTo(0, 0));
        await shot(page, `metrics-${locale}-${theme}-${width}`);
        const bounds = await geometry(page);
        observations.push({ locale, theme, width, bounds });
        const select = page.getByRole("combobox", {
          name: messages[locale].reporting.store,
          exact: true,
        });
        await select.click();
        await page.getByRole("listbox").waitFor();
        assert.deepEqual(
          await geometry(page),
          bounds,
          `${locale}/${theme}/${width} dropdown layout shift`,
        );
        await page.screenshot({
          path: `${output}/metrics-dropdown-${locale}-${theme}-${width}.png`,
        });
        await page.keyboard.press("Escape");
      }
    }
  }
  record(
    "Metrics and header: RU/KG/EN, light/dark, 360/768/1440px; open menus preserve field bounds",
  );
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ru", url: base }]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const path of ["/reports", "/reports/analytics", "/products", "/dashboard"]) {
    await page.goto(base + path);
    await page.locator("[data-baam-launcher]").waitFor();
    const select = page.locator('button[role="combobox"]:visible').first();
    await select.click();
    await page.getByRole("listbox").waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await shot(page, `reference-${path.replaceAll("/", "-")}`);
    assert.equal(await page.locator("select:visible").count(), 0);
  }
  record("Reports, analytics, products and dashboard share keyboard-accessible styled selects");
  await page.goto(
    `${base}/products?storeId=${fixture.storeId}&q=${encodeURIComponent(fixture.products[0].sku)}`,
  );
  await page.locator('[data-component="data-table"] tbody [role="checkbox"]').first().click();
  await page.getByRole("button", { name: "Применить скидку", exact: true }).click();
  const discount = page.getByRole("dialog");
  await discount.waitFor();
  const discountStore = discount.getByRole("combobox");
  await discount.getByRole("button", { name: "Предпросмотр", exact: true }).click();
  await discount.getByText("Будет изменено товаров", { exact: true }).waitFor();
  await discountStore.click();
  await page.getByRole("option").last().click();
  assert.ok((await discountStore.innerText()).trim());
  assert.equal(
    await discount.getByText("Будет изменено товаров", { exact: true }).count(),
    0,
    "Store change must invalidate the previous preview",
  );
  await page.screenshot({ path: `${output}/discount-select.png` });
  await page.keyboard.press("Escape");
  record(
    "Discount form: shared store Select, selection and preview through existing read-only service",
  );
  await page.goto(base + "/inventory/movements");
  await page.locator("[data-component=data-table] tbody tr").first().waitFor();
  const pageSize = page.getByRole("combobox", { name: "Строк на странице", exact: true });
  await pageSize.scrollIntoViewIfNeeded();
  await pageSize.click();
  await page.getByRole("listbox").waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "option");
  await page.keyboard.press("Home");
  await page.waitForFunction(() => document.activeElement?.textContent === "10");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.searchParams.get("pageSize") === "10");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    for (const theme of process.env.UI_CONTROLS_FAST ? ["light"] : ["light", "dark"]) {
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle("dark", theme === "dark"),
        theme,
      );
      const next = page.getByRole("button", { name: "Следующая страница", exact: true });
      await next.scrollIntoViewIfNeeded();
      if (width >= 768) {
        const scroller = page.locator('[data-component="data-table"] > div').first();
        const contour = await scroller.evaluate((el) => ({
          radius: getComputedStyle(el).borderRadius,
          border: getComputedStyle(el).borderBottomWidth,
          shadow: getComputedStyle(el).boxShadow,
        }));
        assert.deepEqual(contour, { radius: "0px", border: "0px", shadow: "none" });
        await scroller.evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
        });
        if (width === 768)
          assert.ok(
            (await scroller.evaluate((el) => el.scrollLeft)) > 0,
            "Horizontal table scroll lost",
          );
      }
      await shot(page, `movements-${theme}-${width}`);
      if (await next.isEnabled()) {
        await next.click();
        await page.getByRole("button", { name: "Предыдущая страница", exact: true }).click();
      }
    }
  }
  record(
    "Movements: flat inner contour, last row, single separator, pagination, horizontal scroll and mobile themes",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const role of ["admin", "manager"]) {
    const c = role === "admin" ? context : await login(role),
      p = role === "admin" ? page : await c.newPage();
    const register = await api(
      context,
      "pos.registers.create",
      { storeId: fixture.storeId, name: `UI controls ${role}`, code: randomUUID().slice(0, 8) },
      true,
    );
    const shift = await api(
      c,
      "pos.shifts.open",
      { registerId: register.id, openingCashKgs: 0, idempotencyKey: randomUUID() },
      true,
    );
    const conversationTitle = `UI controls ${role} ${randomUUID().slice(0, 8)}`;
    const conversation = await api(
      c,
      "baam.createConversation",
      { locale: "ru", storeId: fixture.storeId },
      true,
    );
    await api(
      c,
      "baam.changeConversation",
      { id: conversation.id, revision: 0, title: conversationTitle },
      true,
    );
    await p.goto(base + "/pos");
    const session = await (await c.request.get(base + "/api/auth/session")).json();
    await p.evaluate(({ key, id }) => localStorage.setItem(key, id), {
      key: `baam-dialog:${session.user.organizationId}:${session.user.id}`,
      id: conversation.id,
    });
    for (const path of ["/inventory", "/products", `/pos?registerId=${register.id}`]) {
      await p.goto(base + path);
      await p.locator("[data-baam-launcher]").waitFor();
      await noOverflow(p);
    }
    await openChat(p);
    await p.getByRole("button", { name: "Диалоги", exact: true }).click();
    await p.getByRole("button", { name: new RegExp(conversationTitle) }).click();
    const question = p.locator("[data-baam-drawer] [data-baam-input]");
    await question.fill(`UI controls draft ${role}`);
    await closeChat(p);
    const sale = p.locator('a[href*="/pos/sell"]').filter({ visible: true }).first();
    await sale.click();
    await p.waitForURL(/\/pos\/sell/);
    assert.equal(await p.locator("[data-baam-launcher], [data-baam-drawer]").count(), 0);
    await p.goBack();
    await p.locator("[data-baam-launcher]").waitFor();
    await openChat(p);
    assert.equal(await question.inputValue(), `UI controls draft ${role}`);
    // Browser forward enters checkout while the assistant is still open.
    await p.goForward();
    await p.waitForURL(/\/pos\/sell/);
    assert.equal(await p.locator("[data-baam-launcher], [data-baam-drawer]").count(), 0);
    await p.goBack();
    await openChat(p);
    assert.equal(await question.inputValue(), `UI controls draft ${role}`);
    const store = p.locator("[data-baam-drawer]").getByRole("combobox");
    await store.click();
    await p.getByRole("listbox").waitFor();
    await p.keyboard.press("Escape");
    await p.getByRole("listbox").waitFor({ state: "hidden" });
    await p.waitForFunction(() => document.activeElement?.id === "baam-store");
    await closeChat(p);
    await p.setViewportSize({ width: 390, height: 844 });
    await noOverflow(p);
    await openChat(p);
    await p.getByRole("button", { name: "Переименовать", exact: true }).waitFor();
    await p.screenshot({ path: `${output}/baam-${role}-mobile.png` });
    await p.getByRole("button", { name: "Диалоги", exact: true }).click();
    await p.getByRole("button", { name: new RegExp(conversationTitle) }).waitFor();
    await p.screenshot({ path: `${output}/baam-${role}-history-mobile.png` });
    await p.getByRole("button", { name: new RegExp(conversationTitle) }).click();
    await closeChat(p);
    await p.reload();
    await openChat(p);
    assert.equal(await question.inputValue(), `UI controls draft ${role}`);
    await closeChat(p);
    await p.goto(base + "/ru/pos/sell/?registerId=invalid");
    await p.locator("main").first().waitFor();
    assert.equal(await p.locator("[data-baam-launcher], [data-baam-drawer]").count(), 0);
    await api(
      c,
      "pos.shifts.close",
      { shiftId: shift.id, closingCashCountedKgs: 0, idempotencyKey: randomUUID() },
      true,
    );
    if (role !== "admin") await c.close();
  }
  record(
    "ADMIN/MANAGER: single header BAAM, POS/inventory/products, client checkout round trip preserves draft, focus return, mobile chat, localized checkout hidden",
  );
  for (const role of ["staff", "cashier"]) {
    const c = await login(role),
      p = await c.newPage();
    await p.goto(base + "/pos");
    await p.locator("main").first().waitFor();
    assert.equal(await p.locator("[data-baam-launcher], [data-baam-drawer]").count(), 0);
    await c.close();
  }
  record("STAFF/CASHIER still have no BAAM entry point");
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error);
  console.error(error);
  for (const [index, page] of browser
    .contexts()
    .flatMap((c) => c.pages())
    .entries()) {
    console.error("Failed page", page.url());
    await page.screenshot({ path: `${output}/failure-${index}.png` }).catch(() => undefined);
  }
  process.exitCode = 1;
} finally {
  await writeFile(
    `${output}/results.json`,
    JSON.stringify({ checks, observations, errors, failure }, null, 2),
  );
  await browser.close();
}
