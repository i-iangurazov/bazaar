import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.QA_BASE_URL ?? "http://localhost:3120";
assert(["http://localhost:3120", "https://www.bazaar.kg"].includes(base));
const production = base.startsWith("https:");
const sha = process.env.QA_EXPECTED_SHA;
if (production) assert(sha && /^[a-f0-9]{40}$/.test(sha), "Production requires QA_EXPECTED_SHA");
const output = `artifacts/bazaar-landing-restoration/${production ? "production" : "local"}`;
await mkdir(output, { recursive: true });
const report = {
  base,
  expectedSha: sha,
  baseline: "4b5e5ce379031bb9f51737c3c193875ff5432b2a",
  checks: [],
  errors: [],
  status: "running",
};
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
async function contextFor(locale, width, theme = "dark") {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    hasTouch: width < 1000,
    locale: locale === "kg" ? "ky-KG" : locale,
    reducedMotion: "reduce",
  });
  await context.addCookies([
    { name: "NEXT_LOCALE", value: locale, url: base },
    { name: "theme", value: theme, url: base },
  ]);
  // Anonymous GETs only. Locale is a browser preference; no accounts or business records are created.
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
  return context;
}
async function verifyMenu(page, label, scroll) {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), scroll);
  const previous = await page.evaluate(() => scrollY);
  await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Мобильная навигация", exact: true });
  await dialog.waitFor();
  const panel = page.locator("#marketing-mobile-navigation");
  // Regression: before restoration fix, the filtered header shrinks this panel to 56 px.
  const surface = await panel.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const header = document.querySelector("header").getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      viewport: innerHeight,
      headerBottom: header.bottom,
      background: getComputedStyle(el).backgroundColor,
      nestedInHeader: !!el.closest("header"),
    };
  });
  assert.equal(surface.background, "rgb(7, 11, 19)", "The menu panel must be fully opaque");
  assert.equal(surface.nestedInHeader, false, "A filtered header must not contain the fixed panel");
  assert(Math.abs(surface.top - surface.headerBottom) <= 1);
  assert(
    Math.abs(surface.bottom - surface.viewport) <= 1 && surface.height > 500,
    JSON.stringify(surface),
  );
  assert.equal(
    await page.locator("header").evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(7, 11, 19)",
  );
  assert.equal(await page.evaluate(() => document.body.style.position), "fixed");
  await page.screenshot({ path: `${output}/${label}-menu-${scroll ? "scrolled" : "top"}.png` });
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press(i < 12 ? "Tab" : "Shift+Tab");
    assert(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
      "Focus stays in navigation",
    );
  }
  await page.mouse.wheel(0, 700);
  // Playwright sends wheel input without waiting for the browser to process it.
  await page.waitForTimeout(350);
  assert.equal(
    await page.evaluate(() => Number.parseFloat(document.body.style.top)),
    -previous || 0,
  );
  assert(
    await page.locator("#platform").evaluate((el) => el.inert),
    "Background is not interactive",
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert(
    Math.abs((await page.evaluate(() => scrollY)) - previous) < 2,
    `${label} scroll ${scroll}: expected ${previous}, received ${await page.evaluate(() => scrollY)}`,
  );
  assert.equal(await page.evaluate(() => document.body.style.position), "");
  assert.equal(await page.locator("#platform").evaluate((el) => el.inert), false);
  assert(
    await page
      .getByRole("button", { name: "Открыть меню", exact: true })
      .evaluate((el) => el === document.activeElement),
  );
  await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
  await page.getByRole("button", { name: "Закрыть меню", exact: true }).click();
  await panel.waitFor({ state: "hidden" });
  assert(
    Math.abs((await page.evaluate(() => scrollY)) - previous) < 2,
    `${label} scroll ${scroll}: expected ${previous}, received ${await page.evaluate(() => scrollY)}`,
  );
}
try {
  for (const locale of ["ru", "kg", "en"])
    for (const width of [360, 390, 768, 1440]) {
      const label = `${locale}-${width}`;
      const context = await contextFor(locale, width);
      const page = await context.newPage();
      page.setDefaultTimeout(20_000);
      page.on("pageerror", (error) => report.errors.push(`${label}: ${error.message}`));
      assert.equal(
        (await page.goto(base, { timeout: 90_000, waitUntil: "networkidle" })).status(),
        200,
      );
      await settle(page);
      // The requested pre-redesign landing has Russian copy and no language selector.
      // Keep app locale cookies intact and test the localized auth entry points below.
      assert.equal(await page.title(), "Bazaar — Retail OS для современного магазина");
      assert.equal(await page.locator("html").getAttribute("lang"), locale);
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal(
        (await page.locator("h1").innerText()).replace(/\s+/g, " "),
        "Весь ваш магазин. В одной системе.",
      );
      assert.equal(
        await page.locator("html").evaluate((el) => el.classList.contains("dark")),
        false,
      );
      assert.equal(
        new URL(await page.locator('link[rel="canonical"]').getAttribute("href")).href,
        "https://www.bazaar.kg/",
      );
      await noOverflow(page, label);
      // Visit each visible capture and await its actual load/decode. A fast timed scroll can
      // skip native lazy-image activation on a busy CI runner, even after networkidle.
      for (const picture of await page.locator("main img").all()) {
        if (!(await picture.evaluate((img) => img.getClientRects().length > 0))) continue;
        // Scroll only the page. scrollIntoView can also pan overflow-hidden product frames.
        await picture.evaluate((img) =>
          window.scrollTo({
            top: scrollY + img.getBoundingClientRect().top - innerHeight / 3,
            behavior: "instant",
          }),
        );
        const element = await picture.elementHandle();
        assert(element);
        try {
          await page.waitForFunction((img) => img.complete && img.naturalWidth > 0, element);
          await picture.evaluate((img) => img.decode());
        } finally {
          await element.dispose();
        }
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.waitForFunction(
        () =>
          scrollY === 0 &&
          getComputedStyle(document.querySelector("header")).backdropFilter === "none",
      );
      await settle(page);
      assert.equal(
        await page
          .getByRole("tablist")
          .locator("..")
          .evaluate((el) => el.scrollLeft),
        0,
        "Screenshot traversal must not pan the product demonstration",
      );
      await page.screenshot({ path: `${output}/${label}-hero.png` });
      await page.screenshot({ path: `${output}/${label}-full.png`, fullPage: true });
      assert(
        await page
          .locator("main img")
          .evaluateAll((images) =>
            images
              .filter((img) => img.getClientRects().length > 0)
              .every((img) => img.complete && img.naturalWidth > 0),
          ),
        "Original captures load",
      );
      const structured = JSON.parse(
        await page.locator('script[type="application/ld+json"]').textContent(),
      );
      assert.equal(structured["@type"], "SoftwareApplication");
      assert.deepEqual(
        structured.offers.map((offer) => offer.price),
        ["1750", "4375", "8750"],
      );
      const prices = await page.locator("#pricing article").allTextContents();
      structured.offers.forEach((offer, i) =>
        assert(prices[i].replace(/\s/g, "").includes(offer.price)),
      );
      assert((await page.locator('a[href="/signup"]').count()) >= 5);
      for (const href of await page
        .locator('a[href^="#"]')
        .evaluateAll((links) => links.map((link) => link.getAttribute("href")))) {
        assert.equal(await page.locator(href).count(), 1, `Existing anchor ${href}`);
      }
      if (width < 1000) {
        await verifyMenu(page, label, 0);
        await verifyMenu(page, label, 700);
        for (const anchor of ["platform", "pos", "commerce", "pricing"]) {
          await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
          await page.locator(`#marketing-mobile-navigation a[href="#${anchor}"]`).click();
          await page.getByRole("dialog").waitFor({ state: "hidden" });
          assert.equal(new URL(page.url()).hash, `#${anchor}`);
          assert.equal(await page.evaluate(() => document.body.style.position), "");
          const top = await page
            .locator(`#${anchor}`)
            .evaluate((el) => el.getBoundingClientRect().top);
          assert(top >= 68 && top <= 90, `Anchor is below the fixed header: ${top}`);
          assert(await page.locator(`#${anchor}`).evaluate((el) => el === document.activeElement));
        }
      } else {
        await page.locator('header a[href="#pricing"]').click();
        assert.equal(new URL(page.url()).hash, "#pricing");
        assert(await page.locator("#pricing h2").isVisible());
      }
      assert.equal(await page.getByRole("tab").count(), 6);
      await page.getByRole("tab").first().focus();
      for (let i = 1; i <= 6; i++) {
        await page.keyboard.press("ArrowRight");
        assert.equal(
          await page
            .getByRole("tab")
            .nth(i % 6)
            .getAttribute("aria-selected"),
          "true",
        );
        assert.equal(await page.getByRole("tabpanel").count(), 1);
      }
      await page.keyboard.press("ArrowLeft");
      assert.equal(await page.getByRole("tab").last().getAttribute("aria-selected"), "true");
      const comparison = page.locator("#pricing details");
      await comparison.locator("summary").focus();
      await page.keyboard.press("Enter");
      assert.equal(await comparison.getAttribute("open"), "");
      await page.keyboard.press("Enter");
      assert.equal(await comparison.getAttribute("open"), null);
      if (width === 1440 || width === 390) {
        if (width === 390) {
          await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
          await page.locator('#marketing-mobile-navigation a[href="/signup"]').click();
        } else await page.locator('main a[href="/signup"]').first().click();
        await page.waitForURL("**/signup");
        await settle(page);
        assert.equal(await page.locator("html").getAttribute("lang"), locale);
        await page.locator("input").first().waitFor();
        assert((await page.locator("input").count()) > 0);
        const preferred = page.locator("#signup-preferred-locale");
        if (await preferred.count())
          assert.equal((await preferred.innerText()).trim(), locale.toUpperCase());
        assert.equal(await page.evaluate(() => document.body.style.position), "");
        await page.goto(base, { waitUntil: "networkidle" });
        if (width === 390) {
          await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
          await page.locator('#marketing-mobile-navigation a[href="/login"]').click();
        } else await page.locator('header a[href="/login"]').click();
        await page.waitForURL("**/login");
        await settle(page);
        assert.equal(await page.locator("html").getAttribute("lang"), locale);
        await page.locator('input[type="password"]').waitFor();
        assert((await page.locator('input[type="password"]').count()) > 0);
        for (const next of ["en", "kg", "ru"]) {
          await page
            .getByRole("button")
            .filter({ hasText: new RegExp(`^${next.toUpperCase()}$`) })
            .click();
          await page.waitForFunction(
            (expected) => document.documentElement.lang === expected,
            next,
          );
        }
        record(
          `${label}: actual signup/login CTA and RU → EN → KG → RU auth language switching; no forms submitted`,
        );
      }
      record(
        `${label}: original story/captures/prices/SEO, complete page, menu, anchors, six tabs and comparison`,
      );
      await context.close();
    }
  for (const theme of ["light", "dark"]) {
    const context = await contextFor("ru", 390, theme);
    const page = await context.newPage();
    page.on("pageerror", (error) => report.errors.push(`theme-${theme}: ${error.message}`));
    await page.goto(base, { waitUntil: "networkidle" });
    assert.equal(await page.locator("html").evaluate((el) => el.classList.contains("dark")), false);
    await verifyMenu(page, `theme-${theme}`, 700);
    for (const width of [899, 900, 999, 1000, 1199, 1200]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page, `boundary-${width}`);
      if (width < 1000) {
        await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
        await page.getByRole("dialog").waitFor();
        // Regression for JS's former 900 px breakpoint vs CSS's 1000 px breakpoint.
        await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
        assert.equal(await page.getByRole("dialog").count(), 1);
        await page.keyboard.press("Escape");
      } else
        assert.equal(
          await page.getByRole("button", { name: "Открыть меню", exact: true }).isVisible(),
          false,
        );
    }
    await page.setViewportSize({ width: 390, height: 360 });
    await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
    const signup = page.locator('#marketing-mobile-navigation a[href="/signup"]');
    await signup.scrollIntoViewIfNeeded();
    const box = await signup.boundingBox();
    assert(box.y >= 68 && box.y + box.height <= 360);
    await page.screenshot({ path: `${output}/short-menu-${theme}.png` });
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => document.body.style.position), "");
    record(
      `${theme}: original theme isolation, 899/900/999/1000/1199/1200 px, short menu scroll and resize cleanup`,
    );
    await context.close();
  }
  const context = await browser.newContext({
    javaScriptEnabled: false,
    locale: "ru-RU",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(base);
  assert((await page.locator("h1").innerText()).includes("Весь ваш магазин."));
  assert((await page.locator("#pricing").innerText()).includes("Новичок"));
  await context.close();
  record("Product story and pricing remain readable without JavaScript");
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
