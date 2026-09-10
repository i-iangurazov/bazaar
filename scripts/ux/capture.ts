import { chromium, type Page } from "playwright";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
const base = process.env.UX_HTTPS === "1" ? "https://localhost:3122" : "http://localhost:3122";
const directory = "artifacts/ux/after";
await mkdir(directory, { recursive: true });
const f = JSON.parse(await readFile("artifacts/ux/fixture.json", "utf8"));
const detailsOnly = process.argv.includes("--details-only");
const detailPaths = Object.values(f.detailRoutes ?? {}) as string[];
const uninstantiatedRoutes = () =>
  allPages.filter((path) => path.includes("[") && !f.detailRoutes?.[path]);
const messages = Object.fromEntries(
  await Promise.all(
    ["ru", "en", "kg"].map(async (locale) => [
      locale,
      JSON.parse(await readFile(`messages/${locale}.json`, "utf8")),
    ]),
  ),
);
const primary = [
  "/dashboard",
  "/products",
  "/inventory",
  "/pos",
  `/pos/sell?registerId=${f.registerId}`,
  "/inventory/movements",
  "/purchase-orders",
  "/customers",
  "/suppliers",
  "/sales/orders",
  "/reports",
  "/reports/analytics",
  "/stores",
  "/settings/users",
  "/products/new",
  "/inventory/receiving",
  "/inventory/transfers",
  `/products/${f.longProductId}`,
  `/purchase-orders/${f.purchase.id}`,
  "/baam",
  ...detailPaths,
];
const allPages = (await readdir("src/app/(app)", { recursive: true }))
  .filter((path) => path.endsWith("/page.tsx"))
  .map((path) => "/" + path.replace(/\/page\.tsx$/, ""));
const staticPages = allPages.filter((path) => !path.includes("[") && !path.startsWith("/dev/"));
const browser = await chromium.launch();
type Observation = {
  role: string;
  path: string;
  actualPath: string;
  width: number;
  theme: string;
  locale: string;
  dimensions: { viewport: number; page: number; height: number };
  errors: string[];
  screenshot: string;
  zoom?: number;
};
const report: Observation[] = detailsOnly
  ? JSON.parse(await readFile(`${directory}/report.json`, "utf8")).report
  : [];
let failure: string | undefined;
async function until(check: () => Promise<boolean>, message: string, timeout = 45_000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
async function settle(page: Page) {
  await page.locator("main").first().waitFor({ timeout: 90_000 });
  await page.evaluate(() => document.fonts.ready);
  if (new URL(page.url()).pathname === "/dashboard")
    await page.locator("[data-dashboard-kpi]").first().waitFor({ timeout: 90_000 });
  if (await page.locator("[data-list-toolbar]").count())
    await until(
      async () => !(await page.locator('[data-list-toolbar][aria-busy="true"]').count()),
      "List is still loading",
    );
  await page.waitForTimeout(900);
}
try {
  for (const role of detailsOnly ? ["admin"] : ["admin", "manager", "staff", "cashier"]) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
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
    assert.equal(session.user?.role, role.toUpperCase());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /IntlError|MISSING_MESSAGE|FORMATTING_ERROR/.test(message.text())
      )
        errors.push(message.text().slice(0, 500));
    });
    const capture = async (path: string, width: number, suffix = "", fullPage = false) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      const startErrors = errors.length;
      await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await settle(page);
      const label = path
        .split("?")[0]
        .replace(f.longProductId, "detail")
        .replace(f.purchase.id, "detail")
        .slice(1)
        .replaceAll("/", "-");
      const screenshot = `${label}-${width}${suffix}.png`;
      const details = await page.evaluate(() => ({
        dimensions: {
          viewport: innerWidth,
          page: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        },
        theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
        locale: document.documentElement.lang,
      }));
      await page.screenshot({ path: `${directory}/${role}-${screenshot}` });
      if (fullPage)
        await page.screenshot({
          path: `${directory}/${role}-${label}-${width}${suffix}-full.png`,
          fullPage: true,
        });
      report.push({
        role,
        path,
        actualPath: new URL(page.url()).pathname,
        width,
        ...details,
        errors: errors.slice(startErrors),
        screenshot: `${role}-${screenshot}`,
      });
      await writeFile(
        `${directory}/report.json`,
        JSON.stringify({ report, uninstantiatedRoutes: uninstantiatedRoutes() }, null, 2),
      );
      console.log(
        `${role} ${path} ${width} ${details.theme}/${details.locale} overflow=${details.dimensions.page - details.dimensions.viewport}`,
      );
    };
    const paths =
      role === "admin"
        ? detailsOnly
          ? detailPaths
          : [...new Set([...primary, ...staticPages])]
        : [
            "/dashboard",
            "/products",
            "/inventory",
            "/pos",
            "/customers",
            "/reports",
            "/suppliers",
            "/purchase-orders",
            "/settings/users",
          ];
    for (const path of paths)
      await capture(
        path,
        1440,
        detailsOnly ? "-detail-audit" : "",
        ["/dashboard", "/products/new", "/inventory/receiving"].includes(path),
      );
    if (role === "admin") {
      for (const width of detailsOnly ? [390] : [360, 390, 768])
        for (const path of detailsOnly
          ? detailPaths
          : [
              "/dashboard",
              "/products",
              "/inventory",
              "/products/new",
              "/pos",
              "/inventory/movements",
              "/customers",
              "/sales/orders",
              ...(width === 390 ? detailPaths : []),
            ])
          await capture(path, width, detailsOnly ? "-detail-audit" : "");
      for (const theme of detailsOnly ? [] : ["light", "dark"]) {
        await context.addCookies([{ name: "NEXT_LOCALE", value: "ru", url: base }]);
        await page.goto(base + "/settings/profile");
        await settle(page);
        const themeControl = page.getByRole("combobox").filter({
          hasText: new RegExp(
            `${messages.ru.profile.preferences.themes.light}|${messages.ru.profile.preferences.themes.dark}`,
          ),
        });
        const desiredThemeLabel = messages.ru.profile.preferences.themes[theme];
        const themeSave =
          (await themeControl.textContent())?.trim() !== desiredThemeLabel
            ? page
                .waitForResponse(
                  (response) =>
                    response.url().endsWith("/api/auth/session") &&
                    response.request().method() === "POST",
                  { timeout: 45_000 },
                )
                .then(async (response) => {
                  await response.finished();
                  assert.equal(response.status(), 200);
                  assert.equal((await response.json()).user.themePreference, theme.toUpperCase());
                })
            : Promise.resolve();
        await themeControl.click();
        await page
          .getByRole("option", { name: messages.ru.profile.preferences.themes[theme], exact: true })
          .click();
        // Wait for the actual save response. Polling GET /session during a JWT
        // update races its Set-Cookie and can restore an older cookie in the test.
        await themeSave;
        await until(
          async () =>
            (await page.evaluate(() => document.documentElement.classList.contains("dark"))) ===
            (theme === "dark"),
          "Theme preference did not apply",
        );
        for (const locale of ["ru", "en", "kg"]) {
          await page
            .getByRole("button")
            .filter({ hasText: new RegExp(`^${locale.toUpperCase()}$`) })
            .first()
            .click();
          await until(
            async () => (await page.evaluate(() => document.documentElement.lang)) === locale,
            "Language switch did not apply",
          );
          for (const width of [390, 1440])
            for (const path of [
              "/dashboard",
              "/products",
              "/products/new",
              "/inventory/receiving",
            ]) {
              await capture(path, width, `-${theme}-${locale}`);
              const observation = report.at(-1)!;
              assert.equal(observation.theme, theme);
              assert.equal(observation.locale, locale);
            }
        }
      }
      // Reflow at CSS 200%; this is not claimed as a physical phone or OS browser zoom test.
      for (const path of detailsOnly ? [] : ["/dashboard", "/products", "/products/new"]) {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(base + path);
        await settle(page);
        await page.evaluate(() => {
          document.documentElement.style.zoom = "2";
        });
        await page.screenshot({
          path: `${directory}/admin-${path.slice(1).replaceAll("/", "-")}-zoom200.png`,
          fullPage: true,
        });
        const dimensions = await page.evaluate(() => ({
          viewport: innerWidth,
          page: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        }));
        report.push({
          role,
          path,
          actualPath: new URL(page.url()).pathname,
          width: 1440,
          theme: "dark",
          locale: "kg",
          dimensions,
          errors: [],
          screenshot: `${path}-zoom200`,
          zoom: 200,
        });
      }
      // Restore the isolated account's preferences for following tests.
      await context.request.post(base + "/api/trpc/userSettings.updateMyPreferences", {
        data: { json: { themePreference: "LIGHT", preferredLocale: "ru" } },
      });
    }
    await context.close();
  }
  for (const item of report) {
    assert.ok(item.dimensions.page <= item.dimensions.viewport + 1, JSON.stringify(item));
    assert.deepEqual(item.errors, [], item.path);
  }
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
  console.error(failure);
  process.exitCode = 1;
} finally {
  await writeFile(
    `${directory}/report.json`,
    JSON.stringify({ report, failure, uninstantiatedRoutes: uninstantiatedRoutes() }, null, 2),
  );
  await browser.close();
}
