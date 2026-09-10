import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const base =
  process.env.BAAM_TEST_HTTPS === "1" ? "https://localhost:3121" : "http://localhost:3121";
const directory = "artifacts/baam-companion/after";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BAAM_BROWSER_CHANNEL });
const report: unknown[] = [];
try {
  for (const role of ["admin", "manager", "staff", "cashier"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      ignoreHTTPSErrors: base === "https://localhost:3121",
    });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return ["localhost", "127.0.0.1"].includes(url.hostname) || url.protocol === "data:"
        ? route.continue()
        : route.abort();
    });
    const { csrfToken } = await (await context.request.get(base + "/api/auth/csrf")).json();
    await context.request.post(base + "/api/auth/callback/credentials", {
      form: {
        csrfToken,
        email: `${role}@test.local`,
        password: "BaamCompanion123!",
        json: "true",
        callbackUrl: base + "/pos",
      },
    });
    const session = await (await context.request.get(base + "/api/auth/session")).json();
    assert.equal(session.user?.role, role.toUpperCase(), "Isolated test login must succeed");
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const path of ["/pos", "/inventory", "/products", "/baam"]) {
      let releaseSession: (() => void) | undefined;
      const earlyClick = role === "admin" && path === "/pos";
      if (earlyClick) {
        const gate = new Promise<void>((resolve) => {
          releaseSession = resolve;
        });
        await page.route("**/api/auth/session", async (route) => {
          await gate;
          await route.continue();
        });
      }
      await page.goto(base + path);
      await page.waitForTimeout(1500);
      const launcher = page.locator("[data-baam-launcher]");
      const count = await launcher.count();
      assert.equal(count, ["admin", "manager"].includes(role) ? 1 : 0, `${role} ${path}`);
      report.push({ role, path, count, errors: [...errors] });
      console.log({ role, path, count, url: page.url() });
      if (count && path !== "/baam") {
        await launcher.click();
        if (earlyClick) {
          const loading = page.locator("[data-baam-session-loading]");
          await loading.waitFor();
          assert.equal(await page.locator("[data-baam-chat]").count(), 0);
          assert.equal(
            await page.getByText("BAAM доступен только администратору и менеджеру.").count(),
            0,
          );
          await page.screenshot({ path: `${directory}/early-session-loading.png` });
          releaseSession!();
          // Authentication has its own visible loading phase. The chat-open
          // assertion below still requires the actual authorized panel.
          await loading.waitFor({ state: "hidden" });
          await page.unroute("**/api/auth/session");
          report.push({ role, path, earlyClick: true, unauthorizedFlash: false });
        } else {
          await page.locator("[data-baam-session-loading]").waitFor({ state: "hidden" });
        }
        console.log({
          expanded: await launcher.getAttribute("aria-expanded"),
          dialogs: await page.getByRole("dialog").count(),
        });
        await page
          .locator("[data-baam-chat]")
          .waitFor({ timeout: 10000 })
          .catch(async (e) => {
            await page.screenshot({ path: directory + "/failure.png" });
            await writeFile(
              directory + "/failure.json",
              JSON.stringify({
                role,
                path,
                errors,
                html: await page.locator("body").innerText(),
                expanded: await launcher.getAttribute("aria-expanded"),
              }),
            );
            throw e;
          });
        await page.waitForTimeout(1000);
        await page.screenshot({
          path: `${directory}/${role}-${path.slice(1)}-chat.png`,
          fullPage: false,
        });
        await page.keyboard.press("Escape");
      }
    }
    if (role === "admin") {
      for (const width of [360, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(base + "/inventory");
        await page.locator("[data-baam-launcher]").click();
        console.log({
          width,
          expanded: await page.locator("[data-baam-launcher]").getAttribute("aria-expanded"),
          dialogs: await page.getByRole("dialog").count(),
        });
        await page
          .locator("[data-baam-chat]")
          .waitFor({ timeout: 10000 })
          .catch(async (e) => {
            await page.screenshot({ path: directory + "/failure.png" });
            await writeFile(
              directory + "/failure.json",
              JSON.stringify({
                width,
                errors,
                html: await page.locator("body").innerText(),
                expanded: await page.locator("[data-baam-launcher]").getAttribute("aria-expanded"),
              }),
            );
            throw e;
          });
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${directory}/mobile-${width}-chat.png` });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        assert.equal(
          await page.locator("[data-baam-input]").evaluate((el) => document.activeElement === el),
          true,
        );
        report.push({
          width,
          focus: await page
            .locator("[data-baam-input]")
            .evaluate((el) => document.activeElement === el),
          overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        });
        await page.keyboard.press("Escape");
      }
    }
    if (role === "admin")
      for (const locale of ["en", "kg"]) {
        await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: base }]);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(base + "/inventory");
        await page.locator("[data-baam-launcher]").click();
        await page.locator("[data-baam-chat]").waitFor();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        await page.screenshot({ path: `${directory}/mobile-${locale}-chat.png` });
        await page.keyboard.press("Escape");
      }
    assert.deepEqual(errors, []);
    await context.close();
  }
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
