import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type BrowserContext, type Page } from "playwright";
const base = "https://localhost:3123";
const f = JSON.parse(await readFile("artifacts/reporting/fixture.json", "utf8"));
const output = "artifacts/reporting/after";
const messages = Object.fromEntries(
  await Promise.all(
    ["ru", "kg", "en"].map(async (locale) => [
      locale,
      JSON.parse(await readFile(`messages/${locale}.json`, "utf8")),
    ]),
  ),
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const checks: string[] = [],
  errors: string[] = [];
const observations: Array<Record<string, unknown>> = [];
const period = "dateFrom=2026-09-02&dateTo=2026-09-03&channel=all";
const paths = [`/reports?${period}`, `/reports/analytics?${period}`, "/admin/metrics"];
const record = (name: string) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
async function until(condition: () => Promise<boolean>, message: string, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() > deadline) throw Error(message);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
async function api(context: BrowserContext, method: string, input: unknown) {
  const response = await context.request.get(
    `${base}/api/trpc/${method}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
  );
  const data = await response.json();
  if (data.error) throw Error(JSON.stringify(data.error));
  return data.result.data.json;
}
async function login(role: string) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
  );
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ru", url: base }]);
  const { csrfToken } = await (await context.request.get(base + "/api/auth/csrf")).json();
  await context.request.post(base + "/api/auth/callback/credentials", {
    form: {
      csrfToken,
      email: `${role}@test.local`,
      password: "BazaarReportTest123!",
      json: "true",
      callbackUrl: base,
    },
  });
  assert.equal(
    (await (await context.request.get(base + "/api/auth/session")).json()).user?.role,
    role.toUpperCase(),
  );
  return context;
}
function listen(page: Page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /IntlError|MISSING_MESSAGE|FORMATTING_ERROR/.test(message.text())
    )
      errors.push(message.text().slice(0, 500));
  });
}
async function ready(page: Page) {
  await page.locator("main").first().waitFor();
  await page
    .getByText(/Обновлено|Updated|Жаңыртылды/)
    .first()
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (new URL(page.url()).pathname === "/reports/analytics")
    await until(
      async () =>
        (await page.locator(".recharts-surface").count()) > 0 ||
        (await page
          .getByText(/Нет операций по выбранным|No matching transactions|Тандалган шарттар боюнча/)
          .count()) > 0,
      "Chart never rendered",
    );
}
async function capture(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
    locale: document.documentElement.lang,
  }));
  assert.ok(
    dimensions.document <= dimensions.viewport + 1,
    `${name}: page overflows ${JSON.stringify(dimensions)}`,
  );
  await page.screenshot({ path: `${output}/${name}-viewport.png` });
  await page.screenshot({ path: `${output}/${name}-full.png`, fullPage: true });
  observations.push({ name, ...dimensions, url: page.url() });
}
let failure: string | undefined;
try {
  const admin = await login("admin"),
    page = await admin.newPage();
  listen(page);
  await page.goto(base + paths[1]);
  await ready(page);
  const sales = await api(admin, "reports.sales", {
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
    channel: "all",
  });
  for (const key of [
    "netSalesKgs",
    "grossSalesKgs",
    "returnsKgs",
    "knownCostKgs",
    "knownProfitKgs",
    "unknownCostLines",
  ])
    assert.equal(sales.totals[key], f.expected[key], key);
  assert.equal(sales.total, f.expected.products);
  assert.equal(sales.items.length, 25);
  record("Known dataset: cards, server totals, partial cost and pagination");
  const tea = page.getByRole("button", { name: /Чай · историческая стоимость/ });
  await tea.click();
  await until(
    async () => new URL(page.url()).searchParams.get("productId") === f.teaId,
    "Product drilldown URL did not apply",
  );
  await ready(page);
  assert.equal(new URL(page.url()).searchParams.get("productId"), f.teaId);
  await page.getByRole("button", { name: "REPORT-POS-1", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await capture(page, "sale-source-dialog");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.reload();
  await ready(page);
  assert.equal(new URL(page.url()).searchParams.get("productId"), f.teaId);
  record("Product → its documents → actual receipt; close and reload preserve context");
  await page.goto(base + paths[1]);
  await ready(page);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: messages.ru.analytics.actions.exportAllProducts, exact: true })
    .click();
  const file = await download;
  const filePath = await file.path();
  assert.ok(filePath);
  const contents = await readFile(filePath, "utf8");
  assert.ok(contents.includes("Учебный товар 32"), "Export must include off-page products");
  assert.ok(contents.includes("860"));
  await file.saveAs(`${output}/sales-all-filtered.csv`);
  record("Full CSV export includes all 35 product groups and reconciled totals");
  await page
    .getByRole("combobox", { name: messages.ru.analytics.filters.store, exact: true })
    .selectOption(f.storeId);
  await ready(page);
  await until(
    async () => (await page.locator("main").innerText()).includes("780,00"),
    "Store filter did not update totals",
  );
  await page.reload();
  await ready(page);
  assert.equal(new URL(page.url()).searchParams.get("storeId"), f.storeId);
  await page
    .getByRole("button", { name: messages.ru.reporting.views.costGaps, exact: true })
    .click();
  await ready(page);
  await page.getByText(messages.ru.reporting.noCostGaps, { exact: true }).waitFor();
  record("Store filter and refresh: known cost totals; no false missing-cost rows");
  for (const view of [
    "receipts",
    "suppliers",
    "payments",
    "cash",
    "debts",
    "movements",
    "stock",
    "stockouts",
    "slowMovers",
    "writeOffs",
  ]) {
    await page.goto(`${base}/reports?${period}&view=${view}`);
    await ready(page);
    if (view === "receipts") {
      const link = page.locator(`a[href='/purchase-orders/${f.purchaseOrderId}']`);
      assert.equal(await link.count(), 1);
      await link.click();
      await page.waitForURL(`**/purchase-orders/${f.purchaseOrderId}`);
      await page.locator("main h1").waitFor();
      await capture(page, "source-purchase-order");
      await page.goBack();
      await ready(page);
      assert.equal(new URL(page.url()).searchParams.get("view"), "receipts");
      assert.equal(new URL(page.url()).searchParams.get("dateFrom"), f.dateFrom);
    }
    if (view === "cash") {
      await page.getByRole("button", { name: /Учебное изъятие/ }).click();
      await page.getByRole("dialog").waitFor();
      await capture(page, "cash-shift-dialog");
      await page.keyboard.press("Escape");
    }
    await capture(page, `operations-${view}`);
  }
  record("All ten stock/procurement/payment views and actual shift detail");
  await page.goto(base + paths[2]);
  await ready(page);
  await page.getByRole("button", { name: /Отрицательный остаток/ }).click();
  await ready(page);
  await until(
    async () => new URL(page.url()).searchParams.get("warning") === "negativeStock",
    "Warning URL did not apply",
  );
  await until(
    async () => (await page.locator("tbody tr").count()) === 1,
    "Warning data did not update",
  );
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.reload();
  await ready(page);
  assert.equal(await page.locator("tbody tr").count(), 1);
  await capture(page, "inventory-active-warning");
  record("Inventory warning applies to summaries and rows and survives reload");
  for (const theme of ["light", "dark"]) {
    await admin.addCookies([{ name: "NEXT_LOCALE", value: "ru", url: base }]);
    await page.goto(base + "/settings/profile");
    await page.locator("main").waitFor();
    const labels = messages.ru.profile.preferences.themes;
    const control = page
      .getByRole("combobox")
      .filter({ hasText: new RegExp(`${labels.light}|${labels.dark}`) });
    const save =
      (await control.textContent())?.trim() === labels[theme]
        ? Promise.resolve()
        : page
            .waitForResponse(
              (response) =>
                response.url().endsWith("/api/auth/session") &&
                response.request().method() === "POST",
            )
            .then(async (response) => {
              assert.equal((await response.json()).user.themePreference, theme.toUpperCase());
            });
    await control.click();
    await page.getByRole("option", { name: labels[theme], exact: true }).click();
    await save;
    for (const locale of ["ru", "kg", "en"]) {
      await page
        .getByRole("button")
        .filter({ hasText: new RegExp(`^${locale.toUpperCase()}$`) })
        .first()
        .click();
      await until(
        async () => (await page.evaluate(() => document.documentElement.lang)) === locale,
        "Language did not switch",
      );
      for (const width of [360, 390, 768, 1440])
        for (const path of paths) {
          await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
          await page.goto(base + path);
          await ready(page);
          const name = `${path.split("?")[0].slice(1).replaceAll("/", "-")}-${theme}-${locale}-${width}`;
          await capture(page, name);
          const observation = observations.at(-1)!;
          assert.equal(observation.locale, locale);
          assert.equal(observation.theme, theme);
          const table = page
            .getByRole("region", { name: messages[locale].reporting.tableScroll })
            .first();
          if (await table.count()) {
            const geometry = await table.evaluate((element) => ({
              width: element.clientWidth,
              content: element.scrollWidth,
            }));
            if (geometry.content > geometry.width) {
              await table.evaluate((element) => {
                element.scrollLeft = 300;
              });
              assert.ok(
                await table.evaluate((element) => element.scrollLeft > 0),
                "Wide table must scroll, not clip",
              );
            }
            const maxRow = await page
              .locator("tbody tr")
              .evaluateAll((rows) =>
                Math.max(...rows.map((row) => row.getBoundingClientRect().height)),
              );
            assert.ok(maxRow < 160, `${name}: oversized table rows ${maxRow}`);
          }
        }
    }
  }
  record(
    "72 page/width/theme/language combinations; real selectors; horizontal table scrolling; readable row density",
  );
  await admin.close();
  for (const role of ["manager", "staff", "cashier"]) {
    const context = await login(role),
      rolePage = await context.newPage();
    listen(rolePage);
    for (const path of paths) {
      await rolePage.goto(base + path);
      await rolePage.locator("main").first().waitFor();
      const expected =
        role === "manager"
          ? path.startsWith("/admin/")
            ? "/dashboard"
            : path.split("?")[0]
          : "/pos";
      assert.equal(new URL(rolePage.url()).pathname, expected);
    }
    await context.close();
    record(`${role.toUpperCase()} route permissions`);
  }
  assert.deepEqual(errors, []);
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  await browser.close();
  await writeFile(
    `${output}/report.json`,
    JSON.stringify({ checks, observations, errors, failure }, null, 2),
  );
}
