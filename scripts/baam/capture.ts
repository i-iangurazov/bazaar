import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { openMobileBaam, returnFromMobileBaam } from "./mobile-workspace-check";
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
    page.setDefaultNavigationTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const path of ["/pos", "/inventory", "/products", "/baam", "/pos/sell"]) {
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
      assert.equal(
        count,
        ["admin", "manager"].includes(role) && path !== "/pos/sell" ? 1 : 0,
        `${role} ${path}`,
      );
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
    if (["admin", "manager"].includes(role)) {
      // Use real client navigation and Back/Forward while the dialog is open.
      await page.evaluate(() => {
        document.documentElement.dataset.baamNavigation = "same-document";
      });
      await page
        .locator('a[href="/pos"], a[href^="/pos?"]')
        .filter({ visible: true })
        .first()
        .click();
      await page.waitForURL((url) => url.pathname === "/pos");
      await page.locator("[data-baam-launcher]").click();
      await page.locator("[data-baam-chat]").waitFor();
      await page.goBack();
      await page.waitForURL((url) => url.pathname === "/pos/sell");
      await page.locator("[data-baam-drawer]").waitFor({ state: "hidden" });
      assert.equal(await page.locator("[data-baam-launcher]").count(), 0);
      await page.goForward();
      await page.waitForURL((url) => url.pathname === "/pos");
      await page.locator("[data-baam-launcher]").waitFor();
      assert.equal(await page.locator("[data-baam-drawer]").count(), 0);
      assert.equal(
        await page.locator("html").getAttribute("data-baam-navigation"),
        "same-document",
      );
      report.push({ role, checkoutClientNavigation: "passed" });
    }
    if (role === "admin") {
      const backLabel = async (locale: string) =>
        JSON.parse(await readFile(`messages/${locale}.json`, "utf8")).common.back as string;
      const russianBack = await backLabel("ru");
      for (const width of [360, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(base + "/inventory");
        await page.waitForURL((url) => url.searchParams.get("list") === "1");
        const launcher = page.locator("[data-baam-launcher]");
        const drawer = page.locator("[data-baam-drawer]");
        try {
          const mobile = width < 768 ? await openMobileBaam(page) : null;
          if (!mobile) {
            await launcher.click();
            await drawer.locator("[data-baam-input]").waitFor({ timeout: 10_000 });
            await page.waitForFunction(
              () => document.activeElement?.matches("[data-baam-drawer] [data-baam-input]") === true,
            );
            assert.equal(new URL(page.url()).pathname, "/inventory");
          }
          await page.screenshot({ path: `${directory}/mobile-${width}-chat.png` });
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
          );
          if (mobile) {
            await returnFromMobileBaam(page, mobile.returnTo, russianBack);
          } else {
            await page.keyboard.press("Escape");
            await drawer.waitFor({ state: "hidden" });
          }
          report.push({ width, mode: mobile ? "workspace" : "drawer", focus: true, overflow: false });
        } catch (error) {
          await page.screenshot({ path: directory + "/failure.png" });
          await writeFile(
            directory + "/failure.json",
            JSON.stringify({
              width,
              errors,
              url: page.url(),
              html: await page.locator("body").innerText(),
              expanded: await launcher.getAttribute("aria-expanded"),
            }),
          );
          throw error;
        }
      }
      for (const locale of ["en", "kg"]) {
        await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: base }]);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(base + "/inventory");
        await page.waitForURL((url) => url.searchParams.get("list") === "1");
        const mobile = await openMobileBaam(page);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        await page.screenshot({ path: `${directory}/mobile-${locale}-chat.png` });
        await returnFromMobileBaam(page, mobile.returnTo, await backLabel(locale));
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
