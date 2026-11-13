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
import { twMerge } from "tailwind-merge";
import { chromium, webkit } from "playwright";
import tailwindConfig from "../../tailwind.config.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = path.join(repo, "src/app/globals.css");
const engine = process.env.QA_BROWSER_ENGINE ?? "chromium";
assert(["chromium", "webkit"].includes(engine), "Only isolated Chrome/WebKit are supported");

// Confirm the fixture reproduces this installation's actual Radix dependency
// contract, including its late important rule. Do not disable modal behavior.
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx"))("esbuild");
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

// Read the shipping primitive variant strings, rather than maintaining another
// copy of their dimensions. No shipping component is added to an app route.
const sourceStrings = (file) => {
  const strings = [], parsed = ts.createSourceFile(file, fs.readFileSync(path.join(repo, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => { if (ts.isStringLiteral(node)) strings.push(node.text); ts.forEachChild(node, visit); };
  visit(parsed); return strings;
};
const jsxStringProps = (file, tag) => {
  const parsed = ts.createSourceFile(file, fs.readFileSync(path.join(repo, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  const visit = (node) => {
    if (!found && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(parsed) === tag) found = node;
    ts.forEachChild(node, visit);
  };
  visit(parsed); assert(found, `Use the actual ${file} ${tag} caller`);
  return Object.fromEntries(found.attributes.properties.filter((property) => ts.isJsxAttribute(property) && property.initializer && ts.isStringLiteral(property.initializer))
    .map((property) => [property.name.text, property.initializer.text]));
};
const primitiveVariants = (file, key) => {
  const parsed = ts.createSourceFile(file, fs.readFileSync(path.join(repo, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === "cva") found = node;
    ts.forEachChild(node, visit);
  };
  visit(parsed); assert(found && ts.isStringLiteral(found.arguments[0]));
  const variants = found.arguments[1].properties.find((property) => property.name.text === "variants").initializer;
  const group = variants.properties.find((property) => property.name.text === key).initializer;
  return Object.fromEntries(group.properties.map((property) => [property.name.text, twMerge(found.arguments[0].text, property.initializer.text)]));
};
const modalStrings = sourceStrings("src/components/ui/modal.tsx");
const modalBase = modalStrings.find((text) => text.startsWith("fixed z-[1001]"));
const modalCentered = modalStrings.find((text) => text.startsWith("left-1/2 top-1/2"));
const modalResponsive = modalStrings.find((text) => text.startsWith("bottom-0 left-0 right-0"));
const mobileStrings = sourceStrings("src/components/mobile-app-shell.tsx");
const moreClass = mobileStrings.find((text) => text.startsWith("fixed inset-x-0 bottom-0 z-[1001]"));
const navClass = mobileStrings.find((text) => text.startsWith("fixed inset-x-0 bottom-0 z-40"));
const railClass = sourceStrings("src/components/app-shell.tsx").find((text) => text.startsWith("sticky top-0 hidden h-screen w-[57px]"));
const operationGrids = ["receiving", "transfer", "write-off"].map((name) => sourceStrings(`src/components/inventory/${name}-workflow.tsx`)
  .find((text) => text.includes("xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")));
const receivingGrid = operationGrids[0];
assert(operationGrids.every((classes) => classes === receivingGrid), "The three established operational grids retain the same reviewed dimensions/order");
assert(modalBase && modalCentered && modalResponsive && moreClass && navClass && railClass && receivingGrid, "Reviewed native geometry source contracts changed");
const horizontalSurfaces = [
  ...Object.entries(primitiveVariants("src/components/ui/dialog.tsx", "size")).map(([name, classes]) => [`dialog-${name}`, classes]),
  ...Object.entries(primitiveVariants("src/components/ui/sheet.tsx", "side")).map(([name, classes]) => [`sheet-${name}`, classes]),
  ["modal-centered", twMerge(modalBase, modalCentered)],
  ["modal-responsive", twMerge(modalBase, modalResponsive), 'data-native-overlay-layout="responsive-bottom"'],
  ["mobile-more", moreClass],
].map(([name, classes, attributes = ""]) => [name, `<section id="surface" role="dialog" aria-label="Synthetic ${name}" class="${classes}" ${attributes}>
  <header class="flex shrink-0 items-center justify-between gap-2 p-4"><h2>Synthetic ${name}</h2><button id="close" class="h-11 shrink-0" type="button">Close</button></header>
  <div class="min-h-0 overflow-y-auto p-4"><input id="horizontal-overlay-input" class="h-11 w-full border" aria-label="Synthetic draft" value="retained" /><p>Synthetic offline controls</p></div>
</section>`]);
const horizontalShell = `<main data-bazaar-app class="min-h-screen bg-background"><div class="flex min-h-screen w-full">
  <nav id="rail" class="${railClass}"><button id="rail-report" class="h-[34px] w-[34px]" type="button">R</button><button id="rail-settings" class="h-[34px] w-[34px]" type="button">S</button></nav>
  <section class="min-w-0 flex-1 p-4"><header id="app-header">Synthetic shell</header><div id="baam-workspace" class="fixture-baam-workspace mx-auto min-w-0 max-w-4xl"><input id="horizontal-draft" class="h-11 w-full border" value="Q" /><button id="baam-send" class="ml-auto h-11" type="button">Send</button></div>
  <div id="operation-grid" class="${receivingGrid}"><section id="operation-left" class="min-w-0">Existing left column</section><section id="operation-right" class="min-w-0">Existing right column</section></div></section>
</div><nav id="bottom-nav" data-native-bottom-nav class="${navClass}"><div class="grid grid-cols-3"><button class="h-11">Products</button><button class="h-11">Reports</button><button class="h-11">More</button></div></nav>
<div id="document-actions" class="bazaar-doc-mobile-actions bottom-20 flex justify-between"><button class="h-11">Cancel</button><button class="h-11">Save</button></div></main>`;
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
const inputClasses = fs.readFileSync(path.join(repo, "src/components/ui/input.tsx"), "utf8")
  .match(/className=\{cn\(\s*"([^"]+)"/)?.[1];
assert(inputClasses, "Use the actual shared Input classes for date containment");
const commandModalProps = jsxStringProps("src/components/command-palette.tsx", "Modal");
const commandScanProps = jsxStringProps("src/components/command-palette.tsx", "ScanInput");
assert.equal(commandModalProps.className, "max-w-4xl", "Exercise the demonstrated wider CommandPalette caller");
const commandCopy = JSON.parse(fs.readFileSync(path.join(repo, "messages/ru.json"), "utf8")).commandPalette;
const commandHeader = modalStrings.find((text) => text.startsWith("sticky top-0 z-10 flex items-start"));
const commandBody = modalStrings.find((text) => text.startsWith("flex-1 overflow-y-auto bg-card"));
assert(commandHeader && commandBody && commandScanProps.inputClassName);
const commandPalette = `<section id="surface" role="dialog" aria-label="Synthetic CommandPalette" data-native-overlay-layout="centered"
  class="${twMerge(modalBase, modalCentered, commandModalProps.className)}">
  <header class="${twMerge(commandHeader, commandModalProps.headerClassName)}"><div><h2>${escapeHtml(commandCopy.title)}</h2><p>${escapeHtml(commandCopy.subtitle)}</p></div><button id="close" class="h-11 shrink-0" type="button">Close</button></header>
  <div class="${twMerge(commandBody, commandModalProps.bodyClassName)}"><div class="relative"><input id="command-search" role="combobox" aria-label="Synthetic command search" aria-expanded="false" autofocus inputmode="search" autocomplete="off"
    class="${twMerge(inputClasses, "pr-20", commandScanProps.inputClassName)}" placeholder="${escapeHtml(commandCopy.placeholder)}" /></div><p>Synthetic offline actions; no search or scanner requests.</p></div>
</section>`;
horizontalSurfaces.push(["modal-command-palette", commandPalette]);
const plainNativeFields = `<section id="ordinary-native-fields" class="m-4 grid gap-4"><input id="ordinary-native-input" class="${inputClasses}" aria-label="Synthetic native form field" />
  <select id="ordinary-native-select" class="text-sm sm:text-sm" aria-label="Synthetic native select"><option>Synthetic selection</option></select>
  <textarea id="ordinary-native-textarea" class="text-sm sm:text-sm" aria-label="Synthetic native note"></textarea></section>`;
const reportDates = (variant = "populated") => `<section id="date-card" class="mx-4 rounded-lg border border-border bg-card p-4">
  <div class="grid grid-cols-2 gap-3">
    ${["from", "to"].map((id, index) => `<label id="date-${id}-label" class="grid min-w-0 content-start gap-1.5 text-xs font-medium">
      <span>${index ? "По дату" : "С даты"}</span><input id="date-${id}" aria-label="${index ? "По дату" : "С даты"}"
        type="date" class="${inputClasses}" value="${variant === "blank" ? "" : index ? "2026-11-12" : "2026-10-14"}"
        ${variant === "disabled" ? "disabled" : ""} /></label>`).join("")}
  </div><input id="date-height-reference" type="text" class="${inputClasses}" tabindex="-1" aria-hidden="true"
    style="position:absolute;visibility:hidden;pointer-events:none" ${variant === "disabled" ? "disabled" : ""} /></section>`;
const allMarkup = app + fullscreen("journal") + fullscreen("primitive") + ordinarySheet + ordinaryDialog + centeredMd + reportDates() + plainNativeFields + horizontalShell + horizontalSurfaces.map(([, markup]) => markup).join("");
const anchoredSources = ["tests/e2e/fixtures/native-safe-area-anchors.tsx", "src/components/ui/select.tsx", "src/components/ui/dropdown-menu.tsx", "src/components/ui/popover.tsx", "src/components/ui/tooltip.tsx"]
  .map((file) => ({ raw: fs.readFileSync(path.join(repo, file), "utf8"), extension: "tsx" }));
const compiled = await postcss([
  postcssImport(),
  tailwindcss({ ...tailwindConfig, content: [{ raw: allMarkup, extension: "html" }, ...anchoredSources] }),
]).process(fs.readFileSync(source, "utf8"), { from: source });
const workspaceRule = postcss.parse(fs.readFileSync(path.join(repo, "src/components/baam-native-workspace.module.css"), "utf8")).nodes.find((node) => node.type === "rule" && node.selector === ".workspace");
assert(workspaceRule, "Use the actual Baam workspace box without a second horizontal inset");
const currentCss = compiled.css + `\n.fixture-baam-workspace {${workspaceRule.nodes.map((node) => node.toString()).join(";")}}`;
const beforeNativeEntryFont = postcss.parse(currentCss);
const nativeEntrySelectors = new Set(["html.native-ios input", "html.native-ios select", "html.native-ios textarea"]);
let nativeEntryRulesRemoved = 0;
beforeNativeEntryFont.walkRules((rule) => {
  if (rule.selectors.length === 3 && rule.selectors.every((selector) => nativeEntrySelectors.has(selector.trim()))) {
    rule.remove(); nativeEntryRulesRemoved += 1;
  }
});
assert.equal(nativeEntryRulesRemoved, 1, "The focus-size negative case removes only the native text-entry floor");
const beforeNativeEntryFontCss = beforeNativeEntryFont.toString();
const anchorBundle = await build({ entryPoints: [path.join(repo, "tests/e2e/fixtures/native-safe-area-anchors.tsx")], bundle: true, write: false,
  platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
const anchorScript = anchorBundle.outputFiles[0].text;
const dateBaseline = postcss.parse(currentCss);
let dateRulesRemoved = 0;
dateBaseline.walkRules((rule) => {
  if (rule.selector === 'html.native-ios input[type="date"]' ||
      rule.selector === 'html.native-ios input[type="date"]::-webkit-date-and-time-value') {
    rule.remove(); dateRulesRemoved += 1;
  }
});
assert.equal(dateRulesRemoved, 2, "Compare only the scoped native date correction");
const beforeDateCss = dateBaseline.toString();
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
    (rule.selector === 'html.native-ios [role="dialog"][data-native-overlay-layout="responsive-bottom"]' && rule.nodes.some((node) => node.prop === "top"))
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
const beforeFence = postcss.parse(currentCss);
let fencesRemoved = 0;
beforeFence.walkRules((rule) => { if (rule.selector === "html.native-ios [data-bazaar-app]") { rule.remove(); fencesRemoved += 1; } });
assert.equal(fencesRemoved, 1, "Negative horizontal case removes only the shared AppShell fence");
const beforeFenceCss = beforeFence.toString();

const browser = await (engine === "webkit" ? webkit : chromium).launch({
  headless: true,
  ...(engine === "chromium" ? { channel: "chrome" } : {}),
});
const results = [];
const outputDir = process.env.QA_LAYOUT_OUTPUT_DIR ? path.resolve(process.env.QA_LAYOUT_OUTPUT_DIR) : path.join(repo, ".local/ios-release-20261111/native-overlay-layout");
assert(outputDir.startsWith(path.join(repo, ".local/ios-release-20261111/") ), "QA evidence stays in the owned ignored release folder");
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
const load = async (page, { css = currentCss, platform = "ios", width = 393, height = 844, surface = "", appMarkup = app, left = 0, right = 0 } = {}) => {
  await page.evaluate(() => { window.fixtureReactRoot?.unmount(); window.fixtureReactRoot = undefined; window.fixtureKeyboard?.dispose(); });
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><html class="${platform === "web" ? "" : `native-app native-${platform}`}" style="--native-safe-area-left:${left}px;--native-safe-area-right:${right}px">
    <head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
      <style>${css}</style><style>:root { --mobile-top-safe-area:59px; --mobile-bottom-safe-area:34px; }</style>
    </head><body>${appMarkup}${surface}</body></html>`);
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
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

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

  const dateBounds = () => page.evaluate(() => {
    const card = document.getElementById("date-card");
    const cardBox = card.getBoundingClientRect(), style = getComputedStyle(card);
    return { referenceHeight: document.getElementById("date-height-reference").getBoundingClientRect().height,
      left: cardBox.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth),
      right: cardBox.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth),
      fields: ["from", "to"].map((id) => {
        const input = document.getElementById(`date-${id}`), label = document.getElementById(`date-${id}-label`);
        const box = input.getBoundingClientRect(), parent = label.getBoundingClientRect(), css = getComputedStyle(input);
        return { left: box.left, right: box.right, height: box.height, labelLeft: parent.left, labelRight: parent.right,
          appearance: css.appearance, boxSizing: css.boxSizing, value: input.value, type: input.type, disabled: input.disabled };
      }) };
  });
  for (const width of [320, 393, 1024]) for (const variant of ["populated", "blank", "disabled"]) {
    await load(page, { width, surface: reportDates(variant) });
    const bounds = await dateBounds();
    for (const field of bounds.fields) {
      assert(field.left >= bounds.left - 1 && field.right <= bounds.right + 1);
      assert(field.left >= field.labelLeft - 1 && field.right <= field.labelRight + 1);
      assert.equal(field.appearance, "none"); assert.equal(field.boxSizing, "border-box");
      assert.equal(field.type, "date"); assert.equal(field.disabled, variant === "disabled");
      assert(bounds.referenceHeight > 0 && Math.abs(field.height - bounds.referenceHeight) <= 1,
        "Populated/blank/disabled dates must retain the actual same-class text field height at this viewport");
    }
    assert(bounds.fields[1].left - bounds.fields[0].right >= 11, "Keep the existing 12px date-column gap");
    check(`native date ${variant} stays within two report columns at ${width}`, bounds);
  }
  for (const platform of ["web", "android"]) {
    await load(page, { platform, css: beforeDateCss, width: 1024, surface: reportDates() });
    const before = await dateBounds();
    await load(page, { platform, width: 1024, surface: reportDates() });
    assert.deepEqual(await dateBounds(), before);
    check(`${platform} date appearance and geometry remain unchanged`);
  }

  const safeBox = async (selector) => {
    const box = await page.locator(selector).boundingBox(); assert(box, `Visible geometry required: ${selector}`); return box;
  };
  const insideHorizontal = (box, { width, left, right }, label) => {
    assert(box.x >= left - 1 && box.x + box.width <= width - right + 1,
      `${label} crosses synthetic safe bounds: ${JSON.stringify({ box, width, left, right })}`);
  };
  const asymmetrical = [{ left: 64, right: 12 }, { left: 8, right: 64 }];
  const fontSizes = (selectors) => page.evaluate((selectors) => selectors.map((selector) => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize)), selectors);
  for (const platform of ["ios", "web", "android"]) for (const width of [393, 852]) {
    const insets = { left: 12, right: 64 }, fields = ["#ordinary-native-input", "#ordinary-native-select", "#ordinary-native-textarea"];
    await load(page, { platform, width, height: 600, surface: plainNativeFields, css: beforeNativeEntryFontCss, ...insets });
    const beforeFields = await fontSizes(fields);
    if (width <= 767) assert.deepEqual(beforeFields, [16, 16, 16], "Retain the existing narrow text-entry safeguard");
    else assert(beforeFields.every((size) => Number.isFinite(size) && size > 0 && size < 16),
      `Reproduce the actual below-16px wide text-entry styles: ${JSON.stringify(beforeFields)}`);
    await load(page, { platform, width, height: 600, surface: plainNativeFields, ...insets });
    assert.deepEqual(await fontSizes(fields), platform === "ios" ? [16, 16, 16] : beforeFields);
    await load(page, { platform, width, height: 600, surface: commandPalette, css: beforeNativeEntryFontCss, ...insets });
    await page.locator("#command-search").focus();
    const beforeFont = (await fontSizes(["#command-search"]))[0], beforeBounds = await safeBox("#surface");
    if (width <= 767) assert.equal(beforeFont, 16, "Retain the existing narrow CommandPalette font safeguard");
    else assert(Number.isFinite(beforeFont) && beforeFont > 0 && beforeFont < 16,
      `The actual CommandPalette must reproduce a below-16px landscape autofocus field: ${beforeFont}`);
    await load(page, { platform, width, height: 600, surface: commandPalette, ...insets });
    await page.locator("#command-search").fill("Retained command draft");
    assert.equal((await fontSizes(["#command-search"]))[0], platform === "ios" ? 16 : beforeFont);
    assert.equal(await page.evaluate(() => document.activeElement.id), "command-search");
    assert.equal(await page.locator("#command-search").inputValue(), "Retained command draft");
    assert.deepEqual(await safeBox("#surface"), beforeBounds, "Font floor must not replace the CommandPalette's max-w-4xl geometry");
    if (platform === "ios") {
      insideHorizontal(await safeBox("#surface"), { width, ...insets }, "Wide caller Modal");
      insideHorizontal(await safeBox("#command-search"), { width, ...insets }, "Focused CommandPalette field");
    }
    check(`${platform} exact CommandPalette autofocus/wide Modal and ordinary text-entry size at ${width}`, { beforeFont, afterFont: (await fontSizes(["#command-search"]))[0] });
  }
  await load(page, { width: 1280, height: 844, surface: commandPalette });
  await page.evaluate(() => document.documentElement.style.fontSize = "20px");
  assert.equal((await fontSizes(["#command-search"]))[0], 20, "Keep larger native root-relative text sizing instead of imposing a 16px cap");
  await page.evaluate(() => document.documentElement.style.removeProperty("font-size"));
  check("native text-entry floor preserves larger root-relative sizing and does not restrict user zoom");
  await load(page, { css: beforeFenceCss, appMarkup: horizontalShell, width: 852, height: 393, ...asymmetrical[0] });
  assert((await safeBox("#rail-report")).x < asymmetrical[0].left,
    "The previous unfenced rail must reproduce a control under the synthetic left cutout");
  check("unfenced AppShell reproduces the demonstrated left rail overlap");

  for (const insets of asymmetrical) {
    for (const width of [393, 852, 1280]) {
      await load(page, { appMarkup: horizontalShell, width, height: width === 393 ? 844 : 393, ...insets });
      const bounds = { width, ...insets };
      if (width >= 768) {
        const rail = await safeBox("#rail");
        assert(Math.abs(rail.width - 57) <= 1, "The established navigation rail remains 57px");
        insideHorizontal(await safeBox("#rail-report"), bounds, "Reports rail action");
        insideHorizontal(await safeBox("#rail-settings"), bounds, "Settings rail action");
      } else insideHorizontal(await safeBox("#bottom-nav"), bounds, "Fixed mobile navigation");
      insideHorizontal(await safeBox("#document-actions"), bounds, "Fixed document actions");
      insideHorizontal(await safeBox("#baam-send"), bounds, "Baam Send");
      const workspacePadding = await page.locator("#baam-workspace").evaluate((element) => {
        const style = getComputedStyle(element); return [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)];
      });
      assert.deepEqual(workspacePadding, [0, 0], "Baam must not apply the shell safe area twice");
      if (width >= 1280) {
        const first = await safeBox("#operation-left"), second = await safeBox("#operation-right");
        assert(first.x < second.x && Math.abs(first.width / second.width - 2 / 3) < 0.005,
          "Receiving/transfer/write-off preserve their established left/right 2:3 tracks");
      }
      check(`native shell/nav/actions/Baam keep asymmetric safe bounds at ${width}`, insets);
      if (width === 852) await page.screenshot({ path: path.join(outputDir, `${engine}-horizontal-shell-${insets.left}-${insets.right}.png`) });
    }
    for (const width of [393, 852]) for (const [name, surface] of horizontalSurfaces) {
      if (name === "mobile-more" && width >= 768) continue; // actual existing md:hidden contract
      await load(page, { surface, width, height: 844, ...insets }); await lock(page);
      insideHorizontal(await safeBox("#surface"), { width, ...insets }, name);
      insideHorizontal(await safeBox("#close"), { width, ...insets }, `${name} Close`);
      check(`native ${name} keeps asymmetric horizontal safe bounds at ${width}`, insets);
    }
  }

  await load(page, { appMarkup: horizontalShell, width: 852, height: 393, ...asymmetrical[0] });
  await page.locator("#horizontal-draft").fill("Keep focused Q draft");
  await page.evaluate(() => { document.getElementById("horizontal-draft").focus(); document.documentElement.dataset.nativeKeyboard = "visible"; document.documentElement.style.setProperty("--native-available-height", "250px"); });
  await page.evaluate(({ left, right }) => { document.documentElement.style.setProperty("--native-safe-area-left", `${left}px`); document.documentElement.style.setProperty("--native-safe-area-right", `${right}px`); }, asymmetrical[1]);
  await frame(page);
  assert.equal(await page.locator("#horizontal-draft").inputValue(), "Keep focused Q draft");
  assert.equal(await page.evaluate(() => document.activeElement.id), "horizontal-draft");
  insideHorizontal(await safeBox("#horizontal-draft"), { width: 852, ...asymmetrical[1] }, "Focused native draft after side change");
  insideHorizontal(await safeBox("#baam-send"), { width: 852, ...asymmetrical[1] }, "Send after side change");
  check("shared horizontal correction preserves a focused keyboard-state draft across asymmetric side changes");

  for (const platform of ["web", "android"]) {
    await load(page, { platform, appMarkup: horizontalShell, css: beforeFenceCss, width: 1280, ...asymmetrical[0] });
    const before = { rail: await safeBox("#rail"), workspace: await safeBox("#baam-workspace"), first: await safeBox("#operation-left"), second: await safeBox("#operation-right") };
    await load(page, { platform, appMarkup: horizontalShell, width: 1280, ...asymmetrical[0] });
    assert.deepEqual({ rail: await safeBox("#rail"), workspace: await safeBox("#baam-workspace"), first: await safeBox("#operation-left"), second: await safeBox("#operation-right") }, before);
    check(`${platform} shell/Baam/operational geometry does not acquire native horizontal insets`);
  }

  // Real portalled Radix components, including caller-specified collision
  // padding and Escape/focus return. Only CSS insets are synthetic here.
  for (const [index, insets] of asymmetrical.entries()) for (const kind of ["dropdown", "popover", "select", "tooltip"]) {
    const edge = index ? "right" : "left", width = 852;
    await load(page, { width, height: 600, ...insets });
    await page.addScriptTag({ content: anchorScript });
    await page.evaluate(({ kind, edge }) => window.fixtureMountAnchors(kind, edge), { kind, edge });
    await page.locator("#anchor-trigger").waitFor();
    if (kind === "tooltip") await page.locator("#anchor-trigger").focus();
    else if (kind === "select") await page.locator("#anchor-trigger").press("Enter");
    else await page.locator("#anchor-trigger").click();
    await page.locator("#anchor-surface").waitFor(); await frame(page); await frame(page);
    insideHorizontal(await safeBox("#anchor-surface"), {
      width, left: insets.left + 16, right: insets.right + (["dropdown", "select"].includes(kind) ? 20 : 16),
    }, `Actual portalled ${kind} preserves caller collision padding`);
    assert.equal(await page.locator("[data-native-safe-area-probe]").count(), 1, "All primitives share one native inset probe");
    if (kind === "popover") await page.screenshot({ path: path.join(outputDir, `${engine}-horizontal-popover-${edge}.png`) });
    await page.keyboard.press("Escape");
    await page.locator("#anchor-surface").waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.id === "anchor-trigger", undefined, { timeout: 2000 });
    assert.equal(await page.evaluate(() => document.activeElement.id), "anchor-trigger", `${kind} preserves real Escape focus return`);
    check(`actual portalled ${kind} respects ${edge} safe boundary and restores trigger focus`, insets);
  }

  for (const platform of ["web", "android"]) for (const kind of ["dropdown", "popover", "select", "tooltip"]) {
    await load(page, { platform, width: 852, height: 600, ...asymmetrical[0] });
    await page.addScriptTag({ content: anchorScript });
    await page.evaluate((kind) => window.fixtureMountAnchors(kind, "left"), kind);
    await page.locator("#anchor-trigger").waitFor();
    if (kind === "tooltip") await page.locator("#anchor-trigger").focus();
    else if (kind === "select") await page.locator("#anchor-trigger").press("Enter");
    else await page.locator("#anchor-trigger").click();
    await page.locator("#anchor-surface").waitFor(); await frame(page);
    assert.equal(await page.locator("[data-native-safe-area-probe]").count(), 0, "Other platforms create no native inset coordinator");
    assert((await safeBox("#anchor-trigger")).x < asymmetrical[0].left, "Other platforms retain their original viewport boundary");
    check(`${platform} ${kind} retains existing portal behavior without native side bounds`);
  }
  assert.deepEqual(pageErrors, [], "Real primitives must not introduce browser runtime errors");

  fs.writeFileSync(path.join(outputDir, `${engine}.json`), JSON.stringify({
    result: "PASS", engine, networkBlocked: blockedNetwork, pageErrors, checks: results,
    scope: "Offline layout/scroll fixture plus real anchored Radix interactions with explicit asymmetric CSS inset overrides; not actual WKWebView, iOS keyboard or payment evidence",
  }, null, 2), { mode: 0o600 });
  console.log(`PASS: ${results.length} isolated ${engine} overlay layout/scroll checks`);
  await context.close();
} finally {
  await browser.close();
}
