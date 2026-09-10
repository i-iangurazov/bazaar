import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type Route } from "playwright";
const base = "https://localhost:3123",
  directory = "artifacts/reporting/states";
await mkdir(directory, { recursive: true });
const messages = JSON.parse(await readFile("messages/ru.json", "utf8"));
const browser = await chromium.launch();
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const checks: string[] = [];
await context.route("**/*", (route) =>
  new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
);
await context.addCookies([{ name: "NEXT_LOCALE", value: "ru", url: base }]);
const { csrfToken } = await (await context.request.get(base + "/api/auth/csrf")).json();
await context.request.post(base + "/api/auth/callback/credentials", {
  form: {
    csrfToken,
    email: "admin@test.local",
    password: "BazaarReportTest123!",
    json: "true",
    callbackUrl: base,
  },
});
assert.equal(
  (await (await context.request.get(base + "/api/auth/session")).json()).user?.role,
  "ADMIN",
);
const page = await context.newPage();
const path = "/reports/analytics?dateFrom=2026-09-02&dateTo=2026-09-03&channel=all";
const isSales = (url: string) =>
  new URL(url).pathname.includes("reports.sales") && !url.includes("salesExport");
let failure: string | undefined;
async function ready() {
  await page
    .getByText(/Обновлено/)
    .first()
    .waitFor();
  await page.locator(".recharts-surface").first().waitFor();
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline) throw Error("Expected request was not observed");
    await page.waitForTimeout(50);
  }
}
async function capture(name: string) {
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
}
function failureBody(route: Route, message: string) {
  const error = {
    error: {
      json: { message, code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } },
    },
  };
  const url = new URL(route.request().url());
  return JSON.stringify(
    url.searchParams.has("batch")
      ? url.pathname
          .split("/api/trpc/")[1]
          .split(",")
          .map(() => error)
      : error,
  );
}
try {
  let release!: () => void;
  let held = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loading = async (route: Route) => {
    if (isSales(route.request().url())) {
      held = true;
      await gate;
    }
    await route.continue();
  };
  await page.route("**/api/trpc/**", loading);
  await page.goto(base + path);
  await page.locator('[aria-busy="true"]').first().waitFor();
  await until(() => held);
  await capture("loading");
  assert.ok(held);
  release();
  await ready();
  await page.unroute("**/api/trpc/**", loading);
  checks.push("Loading is distinct from zero; resolves to actual data and chart");
  const reject = async (route: Route) =>
    isSales(route.request().url())
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: failureBody(route, "genericMessage"),
        })
      : route.continue();
  await page.route("**/api/trpc/**", reject);
  await page.reload();
  await page
    .locator("main")
    .getByRole("alert")
    .filter({ hasText: messages.errors.genericMessage })
    .waitFor();
  await capture("error");
  assert.equal(
    await page.getByText(messages.reporting.netSales, { exact: true }).count(),
    0,
    "Failed data must not appear as successful totals",
  );
  await page.unroute("**/api/trpc/**", reject);
  await page.getByRole("button", { name: messages.common.tryAgain, exact: true }).click();
  await ready();
  checks.push("Network failure hides stale totals; retry restores data");
  let releaseOld!: () => void;
  let oldHeld = false;
  const oldGate = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  const reorder = async (route: Route) => {
    if (
      isSales(route.request().url()) &&
      decodeURIComponent(route.request().url()).includes("Чай")
    ) {
      oldHeld = true;
      await oldGate;
    }
    await route.continue();
  };
  await page.route("**/api/trpc/**", reorder);
  const search = page.getByRole("textbox", {
    name: messages.analytics.filters.productSearch,
    exact: true,
  });
  await search.fill("Чай");
  await until(() => oldHeld);
  assert.ok(oldHeld);
  await search.fill("Подарок");
  await ready();
  await page.getByText(/90,00/).first().waitFor();
  assert.ok((await page.locator("main").innerText()).includes("90,00"));
  releaseOld();
  await page.waitForTimeout(600);
  await page.getByText(/90,00/).first().waitFor();
  assert.ok((await page.locator("main").innerText()).includes("90,00"));
  assert.ok(!(await page.locator("main").innerText()).includes("370,00"));
  await capture("latest-filter-wins");
  await page.unroute("**/api/trpc/**", reorder);
  checks.push("Delayed previous search cannot replace the latest product totals");
  await search.fill("NO-MATCH-ISOLATED-REPORT");
  await page.getByText(messages.reporting.emptyPeriod, { exact: true }).first().waitFor();
  await capture("empty-search");
  checks.push("Empty selection is shown explicitly with a reset action");
  await page.goto(base + path);
  await ready();
  const exportFailure = async (route: Route) =>
    route.request().url().includes("reports.salesExport")
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: failureBody(route, "analyticsExportRowLimit"),
        })
      : route.continue();
  let downloads = 0;
  page.on("download", () => {
    downloads++;
  });
  await page.route("**/api/trpc/**", exportFailure);
  await page
    .getByRole("button", { name: messages.analytics.actions.exportAllProducts, exact: true })
    .click();
  // Next.js also renders a route-announcer alert outside main. Require the actual export error.
  await page
    .locator("main")
    .getByRole("alert")
    .filter({ hasText: messages.errors.analyticsExportRowLimit })
    .waitFor();
  assert.equal(downloads, 0);
  await capture("export-failure");
  await page.unroute("**/api/trpc/**", exportFailure);
  checks.push("Failed export does not download a partial or empty file");
  await page.setViewportSize({ width: 720, height: 1000 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await capture("zoom-200-percent");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  checks.push("200% CSS zoom at 720px stays within the page; not a physical-device claim");
  console.log(JSON.stringify({ checks }));
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  await browser.close();
  await writeFile(`${directory}/report.json`, JSON.stringify({ checks, failure }, null, 2));
}
