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
import ts from "typescript";
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
      class="fixed left-1/2 top-1/2 z-[1001] flex h-[100dvh] max-h-[100dvh] w-screen -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden bg-card sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)]">
      <h2 class="shrink-0 p-4">Synthetic full dialog</h2>
      <button id="close" type="button" class="absolute right-4 top-4">Close</button>
      <div id="dialog-scroll" class="min-h-0 flex-1 overflow-y-auto"><div class="h-[1800px] p-4">Synthetic scrollable rows</div></div>
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
// Reproduce the actual default size-md DialogContent / DialogHeader and the
// account-deletion form's overflow-auto body, with real Russian copy. This
// fixture never wires a deletion mutation and must not submit anything.
const privacy = JSON.parse(fs.readFileSync(path.join(repo, "messages/ru.json"), "utf8")).accountPrivacy;
const escapeHtml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const centeredMd = `<section id="surface" role="dialog" aria-label="Synthetic account deletion"
  class="fixed left-1/2 top-1/2 z-[1001] flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card sm:max-h-[calc(100dvh-2rem)] sm:max-w-lg">
  <div class="shrink-0 border-b border-border px-5 py-4 pr-16 sm:px-6">
    <h2 class="text-lg font-semibold">${escapeHtml(privacy.deleteTitle)}</h2>
  </div>
  <form id="dialog-scroll" class="min-h-0 flex-1 space-y-4 overflow-y-auto p-5" onsubmit="event.preventDefault()">
    <p class="mt-1 text-sm text-muted-foreground">${escapeHtml(privacy.deleteSummary)}</p>
    <p class="text-sm leading-6">${escapeHtml(privacy.retention)}</p>
    <p class="text-sm leading-6">${escapeHtml(privacy.appleWarning)}</p>
    <span class="inline-flex min-h-11 items-center text-sm">${escapeHtml(privacy.manageApple)}</span>
    <p class="text-sm leading-6">${escapeHtml(privacy.soleOwner)}</p>
    <div class="space-y-2"><label for="deletion-password">${escapeHtml(privacy.password)}</label><input id="deletion-password" type="password" class="h-10 w-full border" /></div>
    <div class="space-y-2"><label for="deletion-confirmation">${escapeHtml(privacy.confirmation)}</label><input id="deletion-confirmation" class="h-10 w-full border" /></div>
    <div class="flex flex-wrap justify-end gap-2 pt-2"><button id="cancel" type="button">Cancel</button><button type="submit" disabled>${escapeHtml(privacy.deleteConfirm)}</button></div>
  </form><button id="close" type="button" class="absolute right-4 top-4 h-10 w-10">Close</button>
</section>`;
const allMarkup = app + fullscreen("journal") + fullscreen("primitive") + ordinarySheet + ordinaryDialog + centeredMd;
const compiled = await postcss([
  postcssImport(),
  tailwindcss({ ...tailwindConfig, content: [{ raw: allMarkup, extension: "html" }] }),
]).process(fs.readFileSync(source, "utf8"), { from: source });
const currentCss = compiled.css;
// Execute the actual shared coordinator in this offline browser, not a copied
// focus/viewport implementation. No native plugin or shipping test API is added.
const keyboardScript = ts.transpileModule(fs.readFileSync(path.join(repo, "src/lib/native/keyboardViewport.ts"), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replaceAll("export function ", "function ");
const keyboardBaseline = postcss.parse(currentCss);
let keyboardRemoved = 0;
keyboardBaseline.walkRules((rule) => {
  if (rule.selector.startsWith("html.native-ios") && (
    rule.selector.includes('[data-native-keyboard="visible"]') ||
    rule.selector === 'html.native-ios [role="dialog"][class~="top-1/2"]' ||
    rule.selector === 'html.native-ios [role="dialog"][data-native-overlay-layout="responsive-bottom"]'
  )) { rule.remove(); keyboardRemoved += 1; return; }
  if (rule.selector === "html.native-ios") rule.walkDecls("--native-centered-dialog-safe-height", (decl) => {
    decl.value = "calc(100dvh - 2 * max(var(--mobile-top-safe-area), var(--mobile-bottom-safe-area)) - 1rem)";
  });
  if (rule.selector === 'html.native-ios [role="dialog"][class~="h-[100dvh]"]') rule.walkDecls((decl) => {
    if (decl.prop === "top") decl.value = "var(--mobile-top-safe-area)";
    if (decl.prop === "height" || decl.prop === "max-height") decl.value = "calc(100dvh - var(--mobile-top-safe-area))";
  });
});
assert.equal(keyboardRemoved, 6, "The keyboard negative case removes only the reviewed keyboard bounds");
const beforeKeyboardCss = keyboardBaseline.toString();
// Keep the previous root-lock/fullscreen fix in the tall-dialog negative case.
const centeredBaseline = postcss.parse(beforeKeyboardCss);
const centeredSelectors = new Set([
  "html.native-ios",
  'html.native-ios [role="dialog"][class~="top-1/2"][class~="max-h-[calc(100dvh-1rem)]"]',
  'html.native-ios [role="dialog"][class~="top-1/2"][class~="max-h-[85dvh]"]',
]);
let centeredRemoved = 0;
centeredBaseline.walkRules((rule) => {
  if (centeredSelectors.has(rule.selector)) { rule.remove(); centeredRemoved += 1; }
});
assert.equal(centeredRemoved, 4, "Remove only the four reviewed centered-dialog rules");
const beforeCenteredCss = centeredBaseline.toString();
const baseline = postcss.parse(beforeCenteredCss);
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
      scrollTop: (document.getElementById("dialog-scroll") ?? surface).scrollTop } : {}),
    ...(close ? { closeTop: close.top } : {}),
  };
});
const load = async (page, { css = currentCss, platform = "ios", width = 393, height = 844, surface = "" } = {}) => {
  await page.evaluate(() => window.fixtureKeyboard?.dispose());
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><html class="${platform === "web" ? "" : `native-app native-${platform}`}">
    <head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
      <style>${css}</style><style>:root { --mobile-top-safe-area:59px; --mobile-bottom-safe-area:34px; }</style>
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
    assert(scrolled.closeTop >= 59, "Header/absolute close must stay below notch while its actual body scrolls");
    check(`native ${kind} fullscreen bounds, close action and inner scrolling`, scrolled);
    await page.screenshot({ path: path.join(outputDir, `${engine}-${kind}.png`) });
  }

  for (const viewport of [{ width: 393, height: 844 }, { width: 320, height: 667 }]) {
    await load(page, { ...viewport, css: beforeCenteredCss, surface: centeredMd });
    const brokenMd = await state(page);
    assert(brokenMd.top < 59 && brokenMd.closeTop < 59, "Previous size-md layout must reproduce notch overlap");
    await load(page, { ...viewport, surface: centeredMd });
    await lock(page);
    const bounds = await state(page);
    assert(bounds.top >= 59 && bounds.bottom <= viewport.height - 34, JSON.stringify(bounds));
    assert(bounds.closeTop >= 59);
    await page.mouse.move(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2));
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(100);
    assert((await state(page)).scrollTop > 0, "The actual form body must remain scrollable");
    await page.locator("#deletion-password").fill("Synthetic-unused-password");
    await page.locator("#deletion-confirmation").fill("DELETE");
    await page.locator("#cancel").scrollIntoViewIfNeeded();
    const cancel = await page.locator("#cancel").boundingBox();
    assert(cancel && cancel.y >= 59 && cancel.y + cancel.height <= viewport.height - 34);
    const after = await state(page);
    assert.equal(after.y, bounds.y, "Form focus/scroll must not move the locked page");
    assert(after.closeTop >= 59, "Close remains reachable after reaching the last fields");
    check(`native tall size-md header, form fields and Cancel fit safe bounds at ${viewport.width}`, after);
    await page.screenshot({ path: path.join(outputDir, `${engine}-centered-md-${viewport.width}.png`) });
  }

  for (const viewport of [{ width: 393, height: 844 }, { width: 320, height: 667 }]) {
    const bottom = viewport.height - 300;
    const installKeyboard = async () => {
      await page.addScriptTag({ content: `${keyboardScript}\nwindow.fixtureKeyboard = createNativeKeyboardViewport(document.documentElement);` });
      await page.evaluate(() => {
        const form = document.getElementById("dialog-scroll");
        form.scrollTop = form.scrollHeight;
        document.getElementById("deletion-confirmation").focus({ preventScroll: true });
        document.documentElement.dataset.nativeKeyboard = "visible";
        document.body.style.height = `${innerHeight - 300}px`; // actual configured body-only resize
        window.fixtureKeyboard.show(300);
      });
      await frame(page); await frame(page);
    };
    await load(page, { ...viewport, css: beforeKeyboardCss, surface: centeredMd });
    await lock(page); await installKeyboard();
    assert((await page.locator("#deletion-confirmation").boundingBox()).y > bottom,
      "The previous dialog must reproduce the focused field behind the keyboard");
    await load(page, { ...viewport, surface: centeredMd });
    await lock(page); await installKeyboard();
    const bounds = await state(page);
    assert(bounds.top >= 59 && bounds.bottom <= bottom, JSON.stringify(bounds));
    for (const id of ["deletion-confirmation", "deletion-password", "cancel"]) {
      await page.locator(`#${id}`).evaluate((element) => element.focus({ preventScroll: true }));
      await frame(page); await frame(page);
      const field = await page.locator(`#${id}`).boundingBox();
      assert(field && field.y >= 59 && field.y + field.height <= bottom, `${id} must be revealed by its own form scroller`);
      assert.equal((await state(page)).y, bounds.y);
    }
    // Native/visual resize after the keyboard is shown must not subtract again.
    await page.setViewportSize({ width: viewport.width, height: bottom });
    await page.evaluate(() => window.fixtureKeyboard.show(300));
    await frame(page); await frame(page);
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--native-available-height")), `${bottom}px`);
    await page.setViewportSize(viewport);
    await page.evaluate(() => { document.documentElement.dataset.nativeKeyboard = "hidden"; window.fixtureKeyboard.hide(); });
    await frame(page); await frame(page);
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--native-available-height")), `${viewport.height}px`);
    check(`keyboard body resize, focused form/Cancel, no double resize and hide recovery at ${viewport.width}`);
    await page.screenshot({ path: path.join(outputDir, `${engine}-keyboard-recovered-${viewport.width}.png`) });
  }

  for (const [name, surface] of [["journal", fullscreen("journal")], ["dialog", fullscreen("primitive")], ["bottom-sheet", ordinarySheet]]) {
    await load(page, { surface }); await lock(page);
    await page.evaluate(() => {
      document.documentElement.dataset.nativeKeyboard = "visible";
      document.documentElement.style.setProperty("--native-available-height", "544px");
    });
    await frame(page);
    const bounds = await state(page);
    assert(bounds.top >= 59 && bounds.bottom <= 544, JSON.stringify(bounds));
    check(`native ${name} stays above keyboard`, bounds);
  }

  for (const platform of ["web", "android"]) {
    await load(page, { platform, css: beforeCenteredCss, width: 1024, surface: centeredMd });
    const oldBounds = await state(page);
    await load(page, { platform, width: 1024, surface: centeredMd });
    const sameBounds = await state(page);
    assert.equal(sameBounds.top, oldBounds.top);
    assert.equal(sameBounds.height, oldBounds.height);
    check(`${platform} wider size-md dialog geometry remains unchanged`);
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
