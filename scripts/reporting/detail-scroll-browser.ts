import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type Route } from "playwright";

// Read-only UI regression against the fixed, disposable reporting runtime.
const base = "https://localhost:3123";
const out = "artifacts/reporting/states";
const suffix = process.env.REPORT_SCROLL_EVIDENCE === "before" ? "before" : "after";
const messages = JSON.parse(await readFile("messages/ru.json", "utf8"));
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  reducedMotion: "reduce",
  serviceWorkers: "block",
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const checks: string[] = [];
let release: (() => void) | undefined;
const isSales = (url: string) =>
  new URL(url).pathname.includes("reports.sales") && !url.includes("salesExport");
async function until(check: () => Promise<boolean>, message: string) {
  const deadline = Date.now() + 30_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw Error(message);
    await page.waitForTimeout(50);
  }
}
try {
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
  const nav = page.getByRole("navigation", { name: messages.reporting.dimensions, exact: true });
  async function change(label: string, action: () => Promise<unknown>) {
    await nav.evaluate((node) => node.scrollIntoView({ block: "center" }));
    const before = await nav.boundingBox();
    assert.ok(before);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    assert.ok(scrollBefore > 100, "Regression must start below the page header");
    let held = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hold = async (route: Route) => {
      if (isSales(route.request().url())) {
        held = true;
        await gate;
      }
      await route.continue();
    };
    await page.route("**/api/trpc/**", hold);
    await action();
    await until(async () => held, "Detail change did not request updated report data");
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${out}/detail-scroll-${suffix}-${label}-loading.png` });
    assert.ok(await nav.isVisible(), "Detail controls disappeared while loading");
    const pending = await nav.boundingBox();
    assert.ok(pending && Math.abs(pending.y - before.y) < 4,
      `Detail controls moved while loading: ${JSON.stringify({ label, before: before.y, pending: pending?.y })}`);
    assert.ok(
      Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore) < 4,
      "Scroll position changed while loading",
    );
    const response = page.waitForResponse((r) => isSales(r.url()) && r.status() === 200);
    release!();
    await response;
    await until(
      async () =>
        (await nav.locator("xpath=ancestor::section[1]").getAttribute("aria-busy")) !== "true",
      "Updated rows did not render",
    );
    await page.unroute("**/api/trpc/**", hold);
    const after = await nav.boundingBox();
    assert.ok(
      after && after.y >= -after.height && after.y < (page.viewportSize()?.height ?? 0),
      "Detail controls left the viewport after loading",
    );
    assert.ok(
      (await page.evaluate(() => window.scrollY)) > 100,
      "Report jumped back to the page header",
    );
    checks.push(label);
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(base + "/reports/analytics?dateFrom=2026-09-02&dateTo=2026-09-03&channel=all");
    await nav.waitFor();
    await page.locator(".recharts-surface").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const view of [
      "categories",
      "stores",
      "staff",
      "customers",
      "days",
      "documents",
      "costGaps",
      "products",
    ]) {
      await change(`${width}-${view}`, () =>
        nav.getByRole("button", { name: messages.reporting.views[view], exact: true }).click(),
      );
      assert.equal(new URL(page.url()).searchParams.get("view"), view);
    }
    await change(`${width}-sort`, async () => {
      await page.getByRole("combobox", { name: messages.reporting.sort, exact: true }).click();
      await page.getByRole("option", { name: messages.reporting.sorts.name, exact: true }).click();
    });
    assert.equal(new URL(page.url()).searchParams.get("sort"), "name");
    await change(`${width}-direction`, async () => {
      await page.getByRole("combobox", { name: messages.reporting.direction, exact: true }).click();
      await page.getByRole("option", { name: messages.reporting.ascending, exact: true }).click();
    });
    assert.equal(new URL(page.url()).searchParams.get("direction"), "asc");
    await page.screenshot({ path: `${out}/detail-scroll-${suffix}-${width}.png` });
  }
  console.log(JSON.stringify({ checks }));
} finally {
  release?.();
  await writeFile(`${out}/detail-scroll-${suffix}.json`, JSON.stringify({ checks }, null, 2));
  await browser.close();
}
