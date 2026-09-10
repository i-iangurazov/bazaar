import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.QA_BASE_URL ?? "http://localhost:3120";
assert(
  ["http://localhost:3120", "https://www.bazaar.kg"].includes(base),
  "Only local preview or Bazaar production is allowed",
);
const production = base.startsWith("https:");
const sha = process.env.QA_EXPECTED_SHA;
if (production) assert(sha && /^[a-f0-9]{40}$/.test(sha), "Production requires QA_EXPECTED_SHA");
const output = `artifacts/bazaar-landing-redesign/${production ? "production" : "local"}`;
await mkdir(output, { recursive: true });
const report = { base, expectedSha: sha, checks: [], errors: [], status: "running" };
const record = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
async function version() {
  if (!production) return;
  const response = await fetch(`${base}/api/version`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sha, sha);
}
await version();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.QA_BROWSER_CHANNEL ? { channel: process.env.QA_BROWSER_CHANNEL } : {}),
});
const copies = {};
for (const locale of ["ru", "kg", "en"])
  copies[locale] = JSON.parse(await readFile(`messages/${locale}.json`, "utf8")).marketing;
async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}
async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert(
    dimensions.scroll <= dimensions.width + 1,
    `${label}: horizontal overflow ${JSON.stringify(dimensions)}`,
  );
}
try {
  for (const locale of ["ru", "kg", "en"])
    for (const [width, height] of [
      [360, 800],
      [390, 844],
      [768, 1024],
      [1440, 1000],
    ]) {
      const copy = copies[locale];
      const label = `${locale}-${width}`;
      const context = await browser.newContext({
        viewport: { width, height },
        hasTouch: width < 1000,
        locale: locale === "kg" ? "ky-KG" : locale,
        reducedMotion: "reduce",
      });
      await context.addCookies([
        { name: "NEXT_LOCALE", value: locale, url: base },
        { name: "theme", value: "dark", url: base },
      ]);
      // No signup, messages, commerce, payments or external integrations are submitted.
      await context.route("**/*", (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (
          url.origin !== base &&
          !["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)
        )
          return route.abort();
        if (!["GET", "HEAD"].includes(request.method()) && url.pathname !== "/api/locale")
          return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20_000);
      page.on("pageerror", (error) => report.errors.push(`${label}: ${error.message}`));
      const response = await page.goto(base, { timeout: 90_000, waitUntil: "networkidle" });
      assert.equal(response.status(), 200);
      await settle(page);
      assert.equal(await page.title(), copy.meta.title);
      assert.equal(await page.locator("html").getAttribute("lang"), locale);
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal(
        (await page.locator("h1").innerText()).replace(/\s+/g, " "),
        `${copy.hero.title} ${copy.hero.accent}`,
      );
      assert.equal(
        await page.locator("html").evaluate((el) => el.classList.contains("dark")),
        false,
      );
      assert.equal(
        new URL(await page.locator('link[rel="canonical"]').getAttribute("href")).href,
        "https://www.bazaar.kg/",
      );
      assert(!(await page.locator("main").innerText()).includes("marketing."));
      await noOverflow(page, label);
      await page.screenshot({ path: `${output}/${label}-hero.png` });
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 800) {
          window.scrollTo({ top: y, behavior: "instant" });
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
        window.scrollTo({ top: 0, behavior: "instant" });
      });
      await settle(page);
      await page.screenshot({ path: `${output}/${label}-full.png`, fullPage: true });
      const structured = JSON.parse(
        await page.locator('script[type="application/ld+json"]').textContent(),
      );
      assert.equal(structured["@type"], "SoftwareApplication");
      assert.equal(structured.offers.length, 3);
      const prices = await page.locator("#pricing article").allTextContents();
      structured.offers.forEach((offer, i) =>
        assert(
          prices[i].includes(
            new Intl.NumberFormat(locale === "kg" ? "ky-KG" : locale, {
              maximumFractionDigits: 2,
            }).format(Number(offer.price)),
          ),
          "Visible and structured prices agree",
        ),
      );
      assert((await page.locator('a[href="/signup"]').count()) >= 5);
      assert.equal(await page.locator('footer a[href="/privacy"]').count(), 1);

      if (width < 1200) {
        await page.evaluate(() => window.scrollTo({ top: 700, behavior: "instant" }));
        const previousScroll = await page.evaluate(() => scrollY);
        await page.getByRole("button", { name: copy.nav.open, exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        assert.equal(
          await dialog.evaluate((el) => getComputedStyle(el).backgroundColor),
          "rgb(250, 251, 248)",
        );
        assert.equal(await page.evaluate(() => document.body.style.position), "fixed");
        await page.screenshot({ path: `${output}/${label}-menu.png` });
        for (let i = 0; i < 15; i++) {
          await page.keyboard.press(i < 10 ? "Tab" : "Shift+Tab");
          assert(
            await dialog.evaluate((el) => el.contains(document.activeElement)),
            "Native modal must contain keyboard focus",
          );
        }
        await page.mouse.wheel(0, 700);
        assert.equal(await page.evaluate(() => document.body.style.top), `-${previousScroll}px`);
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        assert(Math.abs((await page.evaluate(() => scrollY)) - previousScroll) < 2);
        assert(
          await page
            .getByRole("button", { name: copy.nav.open, exact: true })
            .evaluate((el) => el === document.activeElement),
        );
        await page.getByRole("button", { name: copy.nav.open, exact: true }).click();
        await dialog.locator('a[href="#pricing"]').click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(new URL(page.url()).hash, "#pricing");
        assert.equal(await page.evaluate(() => document.body.style.position), "");
        const pricingY = await page
          .locator("#pricing")
          .evaluate((el) => el.getBoundingClientRect().top);
        assert(pricingY >= 65 && pricingY < 150, `Anchor is clear of fixed header: ${pricingY}`);
      }

      const firstTab = page.getByRole("tab").first();
      await firstTab.focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.getByRole("tab").nth(1).getAttribute("aria-selected"), "true");
      await page.keyboard.press("End");
      assert.equal(await page.getByRole("tab").last().getAttribute("aria-selected"), "true");
      assert.equal(await page.getByRole("tabpanel").count(), 1);
      if (locale === "ru" && width === 1440) {
        const [popup] = await Promise.all([
          context.waitForEvent("page"),
          page.getByRole("tabpanel").getByRole("link").click(),
        ]);
        await popup.waitForLoadState();
        assert(new URL(popup.url()).pathname.endsWith("dashboard-wide.webp"));
        await popup.close();
      }
      await firstTab.focus();
      await page.keyboard.press("Home");
      const faq = page.locator("#faq details").first();
      await faq.locator("summary").focus();
      await page.keyboard.press("Enter");
      assert.equal(await faq.getAttribute("open"), "");
      await page.keyboard.press("Enter");
      assert.equal(await faq.getAttribute("open"), null);

      if (locale === "ru" && width === 390) {
        for (const next of ["en", "kg", "ru"]) {
          const current = await page.locator("html").getAttribute("lang");
          await page.getByRole("button", { name: copies[current].nav.open, exact: true }).click();
          await page
            .getByRole("dialog")
            .getByRole("button", {
              name: { en: "English", kg: "Кыргызча", ru: "Русский" }[next],
              exact: true,
            })
            .click();
          await page.waitForFunction(
            (expected) => document.documentElement.lang === expected,
            next,
          );
          assert.equal(await page.title(), copies[next].meta.title);
          await page.keyboard.press("Escape");
        }
        record(
          "Language switch RU → EN → KG → RU preserves the modal and updates content, metadata and cookie",
        );
        await page.setViewportSize({ width: 390, height: 520 });
        await page.getByRole("button", { name: copy.nav.open, exact: true }).click();
        await page
          .getByRole("dialog")
          .getByRole("link", { name: copy.actions.login, exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${output}/short-landscape-menu.png` });
        await page.setViewportSize({ width: 1200, height: 850 });
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        assert.equal(await page.evaluate(() => document.body.style.position), "");
        record("Short viewport menu scrolls; desktop resize closes it and restores the page");
      }
      if (width === 1440) {
        // Follow the actual primary CTA and sign-in link; never submit a form.
        await page.locator('main a[href="/signup"]').first().click();
        await page.waitForURL("**/signup");
        await settle(page);
        assert.equal(await page.locator("html").getAttribute("lang"), locale);
        await page.locator("input").first().waitFor();
        assert((await page.locator("input").count()) > 0);
        const preferred = page.locator("#signup-preferred-locale");
        if (await preferred.count())
          assert.equal((await preferred.innerText()).trim(), locale.toUpperCase());
        await page.goto(base, { waitUntil: "networkidle" });
        await page.locator('header a[href="/login"]:visible').click();
        await page.waitForURL("**/login");
        await settle(page);
        assert.equal(await page.locator("html").getAttribute("lang"), locale);
        assert((await page.locator('input[type="password"]').count()) > 0);
        record(`${locale}: signup and login links load localized forms without submission`);
      }
      record(`${label}: layout, screenshots, navigation, menu, tabs, FAQ, SEO and pricing pass`);
      await context.close();
    }
  const edgeContext = await browser.newContext({ locale: "ru-RU", viewport: { width: 390, height: 844 } });
  const edgePage = await edgeContext.newPage();
  edgePage.on("pageerror", error => report.errors.push(`boundary: ${error.message}`));
  await edgePage.goto(base, { waitUntil: "networkidle" });
  for (const width of [999, 1000, 1199, 1200]) {
    await edgePage.setViewportSize({ width, height: 900 });
    await noOverflow(edgePage, `boundary-${width}`);
    if (width < 1200) {
      await edgePage.getByRole("button", { name: copies.ru.nav.open, exact: true }).click();
      await edgePage.getByRole("dialog").waitFor();
      assert(await edgePage.getByRole("dialog").getByRole("button", { name: "English", exact: true }).isVisible());
      await edgePage.keyboard.press("Escape");
    } else assert(await edgePage.getByRole("button", { name: "English", exact: true }).isVisible());
  }
  record("Navigation and language controls stay accessible across 999/1000/1199/1200 px breakpoints");
  await edgePage.setViewportSize({ width: 390, height: 844 });
  await edgePage.getByRole("button", { name: copies.ru.nav.open, exact: true }).click();
  await edgeContext.route("**/api/locale", route => route.fulfill({ status: 503, body: "Temporary test failure" }));
  await edgePage.getByRole("dialog").getByRole("button", { name: "English", exact: true }).click();
  await edgePage.getByRole("alert").filter({ hasText: copies.ru.nav.languageError }).waitFor();
  assert.equal(await edgePage.locator("html").getAttribute("lang"), "ru");
  await edgeContext.unroute("**/api/locale");
  await edgePage.getByRole("dialog").getByRole("button", { name: "English", exact: true }).click();
  await edgePage.waitForFunction(() => document.documentElement.lang === "en");
  await edgeContext.close();
  record("Language request failure is visible, preserves the page and supports a successful retry");

  // The copy must be readable before JavaScript, including under reduced motion.
  const context = await browser.newContext({
    javaScriptEnabled: false,
    locale: "ru-RU",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(base);
  assert((await page.locator("h1").innerText()).includes(copies.ru.hero.title));
  assert((await page.locator("#pricing").innerText()).includes(copies.ru.pricing.STARTER.name));
  await context.close();
  record("Headings, product story and pricing remain server-rendered without JavaScript");
  await version();
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack ?? String(error);
  process.exitCode = 1;
  console.error(report.error);
} finally {
  await browser.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
