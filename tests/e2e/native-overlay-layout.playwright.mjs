/**
 * Offline CSS/layout regression. Run serially:
 *   node --import tsx tests/e2e/native-overlay-layout.playwright.mjs
 * Uses installed Chrome by default; QA_BROWSER_ENGINE=webkit uses an already
 * installed Playwright WebKit. No server, account, database or network is used.
 * A deterministic CSS safe-area models a notch; actual WKWebView is checked
 * separately because desktop browser emulation cannot establish iOS behavior.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import postcssImport from "postcss-import";
import tailwindcss from "tailwindcss";
import { chromium, webkit } from "playwright";
import tailwindConfig from "../../tailwind.config.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = path.join(repo, "src/app/globals.css");
const engine = process.env.QA_BROWSER_ENGINE ?? "chromium";
assert(["chromium", "webkit"].includes(engine), "Only isolated Chrome/WebKit are supported");

// Confirm the fixture reproduces this installation's actual Radix dependency
// contract, including its late important rule. Do not disable modal behavior.
const require = createRequire(import.meta.url);
const dialogRequire = createRequire(require.resolve("@radix-ui/react-dialog"));
const removeScrollRequire = createRequire(dialogRequire.resolve("react-remove-scroll"));
const scrollBarEntry = removeScrollRequire.resolve("react-remove-scroll-bar");
const scrollBarSource = fs.readFileSync(path.join(path.dirname(scrollBarEntry), "component.js"), "utf8");
assert(scrollBarSource.includes("data-scroll-locked") && scrollBarSource.includes("overflow: hidden") &&
  scrollBarSource.includes("position: relative"), "Installed scroll-lock contract changed; review fixture");
const radixLockCss = `body[data-scroll-locked] {
  overflow: hidden !important; position: relative !important;
  overscroll-behavior: contain; padding-left: 0; padding-top: 0;
  padding-right: 0; margin-left: 0; margin-top: 0; margin-right: 0 !important;
}`;

const fullscreen = (kind) => kind === "journal"
  ? `<section id="surface" role="dialog" aria-label="Synthetic journal"
      class="fixed bottom-0 left-0 right-0 z-[1001] flex h-[100dvh] max-h-[100dvh] flex-col overflow-y-auto bg-card sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2">
      <header class="sticky top-0 z-10 flex shrink-0 items-center justify-between bg-card p-4">
        <h2>Synthetic journal</h2><button id="close" type="button">Close</button>
      </header><div class="shrink-0 h-[1800px] p-4">Synthetic scrollable rows</div>
    </section>`
  : `<section id="surface" role="dialog" aria-label="Synthetic full dialog"
      class="fixed left-1/2 top-1/2 z-[1001] flex h-[100dvh] max-h-[100dvh] w-screen -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto bg-card sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)]">
      <h2 class="shrink-0 p-4">Synthetic full dialog</h2>
      <button id="close" type="button" class="absolute right-4 top-4">Close</button>
      <div class="shrink-0 h-[1800px] p-4">Synthetic scrollable rows</div>
    </section>`;
const ordinarySheet = `<section id="surface" role="dialog" aria-label="Synthetic bottom sheet"
  class="fixed inset-x-0 bottom-0 z-[1001] h-[300px] max-h-[90dvh] overflow-y-auto bg-card">
  <h2 class="p-4">Synthetic bottom sheet</h2></section>`;
const ordinaryDialog = `<section id="surface" role="dialog" aria-label="Synthetic centered dialog"
  class="fixed left-1/2 top-1/2 z-[1001] h-[300px] max-h-[85dvh] w-[300px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto bg-card">
  <h2 class="p-4">Synthetic centered dialog</h2></section>`;
const app = `<main data-bazaar-app class="min-h-screen bg-background">
  <header id="app-header" class="sticky top-0 z-40 bg-card px-4 pb-2"
    style="padding-top:max(12px,var(--mobile-top-safe-area))">
    <div class="flex min-h-11 items-center">Existing mobile app header</div>
  </header><div class="h-[2500px] p-4">Synthetic product list</div>
</main>`;
const allMarkup = app + fullscreen("journal") + fullscreen("primitive") + ordinarySheet + ordinaryDialog;
const compiled = await postcss([
  postcssImport(),
  tailwindcss({ ...tailwindConfig, content: [{ raw: allMarkup, extension: "html" }] }),
]).process(fs.readFileSync(source, "utf8"), { from: source });
const currentCss = compiled.css;
const baseline = postcss.parse(currentCss);
const addedSelectors = new Set([
  "html.native-ios:has(body[data-scroll-locked])",
  "html.native-ios body[data-scroll-locked]",
  'html.native-ios [role="dialog"][class~="h-[100dvh]"]',
]);
let removed = 0;
baseline.walkRules((rule) => {
  if (addedSelectors.has(rule.selector)) {
    rule.remove();
    removed += 1;
  }
});
assert.equal(removed, 3, "The before/after comparison must remove only the reviewed fix");
const beforeCss = baseline.toString();

const browser = await (engine === "webkit" ? webkit : chromium).launch({
  headless: true,
  ...(engine === "chromium" ? { channel: "chrome" } : {}),
});
const results = [];
const outputDir = path.join(repo, ".local/ios-release-20261111/native-overlay-layout");
fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
const check = (name, detail = {}) => results.push({ name, result: "PASS", ...detail });
const frame = (page) => page.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));
const state = (page) => page.evaluate(() => {
  const html = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  const header = document.getElementById("app-header").getBoundingClientRect();
  const surface = document.getElementById("surface");
  const bounds = surface?.getBoundingClientRect();
  const close = document.getElementById("close")?.getBoundingClientRect();
  return {
    y: scrollY, headerTop: header.top,
    rootOverflow: html.overflowY, bodyOverflow: body.overflowY,
    ...(bounds ? { top: bounds.top, bottom: bounds.bottom, height: bounds.height,
      scrollTop: surface.scrollTop } : {}),
    ...(close ? { closeTop: close.top } : {}),
  };
});
const load = async (page, { css = currentCss, platform = "ios", width = 393, surface = "" } = {}) => {
  await page.setViewportSize({ width, height: 844 });
  await page.setContent(`<!doctype html><html class="${platform === "web" ? "" : `native-app native-${platform}`}">
    <head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
      <style>${css}</style><style>:root { --mobile-top-safe-area:59px; }</style>
    </head><body>${app}${surface}</body></html>`);
  await frame(page);
};
const lock = async (page, count = 1) => {
  await page.evaluate(({ css, count }) => {
    document.getElementById("installed-radix-lock")?.remove();
    const style = document.createElement("style");
    style.id = "installed-radix-lock";
    style.textContent = css;
    document.head.append(style);
    document.body.setAttribute("data-scroll-locked", String(count));
  }, { css: radixLockCss, count });
  await frame(page);
};

try {
  const context = await browser.newContext();
  let blockedNetwork = 0;
  await context.route("**/*", (route) => { blockedNetwork += 1; return route.abort(); });
  const page = await context.newPage();

  // A regression test must reproduce the demonstrated failure before the fix.
  await load(page, { css: beforeCss });
  await page.evaluate(() => scrollTo(0, 480));
  await frame(page);
  assert(Math.abs((await state(page)).headerTop) <= 1);
  await lock(page);
  const broken = await state(page);
  assert(broken.headerTop < -100, `Before fix did not reproduce detached sticky header: ${JSON.stringify(broken)}`);
  check("original body lock reproduces lost sticky header", broken);

  await load(page);
  await page.evaluate(() => scrollTo(0, 480));
  await frame(page);
  await lock(page);
  const locked = await state(page);
  assert.equal(locked.rootOverflow, "hidden");
  assert.equal(locked.bodyOverflow, "clip");
  assert(Math.abs(locked.headerTop) <= 1 && locked.y === 480, JSON.stringify(locked));
  await page.mouse.move(380, 700);
  await page.mouse.wheel(0, 360);
  await page.waitForTimeout(100);
  assert.equal((await state(page)).y, locked.y, "Page must remain wheel-locked");
  check("native root stays locked and sticky header keeps its viewport position", locked);

  await lock(page, 2);
  await page.evaluate(() => document.body.setAttribute("data-scroll-locked", "1"));
  await frame(page);
  assert.equal((await state(page)).rootOverflow, "hidden");
  await page.evaluate(() => document.body.removeAttribute("data-scroll-locked"));
  await frame(page);
  assert.notEqual((await state(page)).rootOverflow, "hidden");
  await page.mouse.wheel(0, 360);
  await page.waitForTimeout(100);
  assert((await state(page)).y > locked.y, "Final modal close must restore page scrolling");
  check("nested lock remains until the final close and then restores scrolling");

  for (const kind of ["journal", "primitive"]) {
    await load(page, { surface: fullscreen(kind) });
    await lock(page);
    const geometry = await state(page);
    assert(Math.abs(geometry.top - 59) <= 1 && Math.abs(geometry.bottom - 844) <= 1, JSON.stringify(geometry));
    assert(geometry.closeTop >= 59, "Fullscreen close action must start below the notch");
    await page.mouse.move(195, 450);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(100);
    const scrolled = await state(page);
    assert(scrolled.scrollTop > 0 && scrolled.y === geometry.y, "Dialog must scroll without scrolling the locked page");
    if (kind === "journal") assert(scrolled.closeTop >= 59, "Sticky journal header must stay below notch after scrolling");
    check(`native ${kind} fullscreen bounds, close action and inner scrolling`, scrolled);
    await page.screenshot({ path: path.join(outputDir, `${engine}-${kind}.png`) });
  }

  for (const [name, surface] of [["bottom sheet", ordinarySheet], ["centered dialog", ordinaryDialog]]) {
    await load(page, { css: beforeCss, surface });
    const before = await state(page);
    await load(page, { surface });
    const after = await state(page);
    assert.equal(after.top, before.top);
    assert.equal(after.height, before.height);
    check(`ordinary native ${name} geometry remains unchanged`);
  }

  for (const platform of ["web", "android"]) {
    await load(page, { platform, surface: fullscreen("journal") });
    await lock(page);
    const unchanged = await state(page);
    assert.equal(unchanged.bodyOverflow, "hidden");
    assert.notEqual(unchanged.rootOverflow, "hidden");
    assert.equal(unchanged.top, 0, "The native-iOS safe-area rule must not affect other surfaces");
    check(`${platform} modal lock and fullscreen presentation remain unchanged`);
  }

  await load(page, { width: 1024, css: beforeCss, surface: fullscreen("primitive") });
  const tabletBefore = await state(page);
  await load(page, { width: 1024, surface: fullscreen("primitive") });
  const tabletAfter = await state(page);
  assert.equal(tabletAfter.top, tabletBefore.top);
  assert.equal(tabletAfter.height, tabletBefore.height);
  check("existing wider inset dialog geometry remains unchanged");

  fs.writeFileSync(path.join(outputDir, `${engine}.json`), JSON.stringify({
    result: "PASS", engine, networkBlocked: blockedNetwork, checks: results,
    scope: "Offline layout/scroll fixture; not actual WKWebView or a full Radix interaction test",
  }, null, 2), { mode: 0o600 });
  console.log(`PASS: ${results.length} isolated ${engine} overlay layout/scroll checks`);
  await context.close();
} finally {
  await browser.close();
}
