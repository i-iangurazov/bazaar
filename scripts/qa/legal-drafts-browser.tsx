import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { legalCopy } from "../../src/content/legal";
import { legalDocumentIds } from "../../src/content/legal/types";
import { themeCookieName } from "../../src/lib/theme";

const base = "http://localhost:3134";
const mode = process.argv[2];
assert(["blocked", "preview", "export"].includes(mode), "Expected blocked, preview or export");
const dir = path.resolve(".local/legal-drafts-20261104");
fs.mkdirSync(dir, { recursive: true });

if (mode === "export") {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const results = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", (route) =>
      ["file:", "data:"].includes(new URL(route.request().url()).protocol)
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    for (const locale of ["ru", "kg", "en"] as const) {
      for (const id of legalDocumentIds) {
        const file = `${id}.${locale}.html`;
        await page.goto(pathToFileURL(path.join(dir, file)).href);
        assert.equal(await page.locator("h1").textContent(), legalCopy[locale].documents[id].title);
        const appearance = await page.locator("h1").evaluate((element) => ({
          size: parseFloat(getComputedStyle(element).fontSize),
          padding: parseFloat(getComputedStyle(document.querySelector("main")!).paddingLeft),
          border: parseFloat(
            getComputedStyle(document.querySelector("article .border")!).borderWidth,
          ),
        }));
        assert(
          appearance.size >= 24 && appearance.padding >= 16 && appearance.border > 0,
          JSON.stringify(appearance),
        );
        await page
          .getByRole("link", { name: legalCopy[locale].documents.refunds.title, exact: true })
          .click();
        await page.waitForURL(`**/refunds.${locale}.html`);
        assert.equal(
          await page.locator("h1").textContent(),
          legalCopy[locale].documents.refunds.title,
        );
        results.push({ file, styles: "PASS", navigation: "PASS" });
      }
    }
    await context.close();
    fs.writeFileSync(path.join(dir, "export.json"), JSON.stringify(results, null, 2));
    console.log(`PASS: ${results.length} offline HTML previews, styles and file navigation`);
  } finally {
    await browser.close();
  }
} else if (mode === "blocked") {
  const results = [];
  const requestHeaders: Record<string, string>[] = [{}, { host: "www.bazaar.kg" }, { RSC: "1" }];
  for (const id of legalDocumentIds) {
    for (const headers of requestHeaders) {
      const response = await fetch(`${base}/legal/${id}`, { headers });
      const body = await response.text();
      assert.equal(response.status, 404, `${id} must not expose a draft`);
      assert(!body.includes("data-legal-draft"), `${id} must not leak draft markup`);
      assert(!body.includes(legalCopy.ru.draftNotice), `${id} must not leak draft text`);
      results.push({ id, headers, status: response.status, draftLeaked: false });
    }
  }
  for (const url of ["/ru/legal/offer", "/kg/legal/refunds", "/en/legal/payment", "/legal"]) {
    const response = await fetch(base + url);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    results.push({ id: url, headers: {}, status: response.status, draftLeaked: false });
  }
  for (const url of ["/privacy", "/login", "/sitemap.xml"]) {
    const response = await fetch(base + url);
    assert.equal(response.status, 200, `Existing public route ${url}`);
    if (url === "/sitemap.xml") assert(!(await response.text()).includes("/legal/"));
  }
  const tag = process.argv[3] === "production" ? "production" : "local-disabled";
  fs.writeFileSync(path.join(dir, `blocked-${tag}.json`), JSON.stringify(results, null, 2));
  console.log(`PASS: ${results.length} HTTP requests blocked without draft content`);
} else {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const results: unknown[] = [];
  const errors: string[] = [];
  const screenshots: string[] = [];
  try {
    for (const locale of ["ru", "kg", "en"] as const) {
      for (const width of [1440, 390]) {
        for (const dark of [false, true]) {
          const context = await browser.newContext({
            viewport: { width, height: 1000 },
            serviceWorkers: "block",
          });
          await context.addCookies([
            { name: "NEXT_LOCALE", value: locale, url: base },
            { name: themeCookieName, value: dark ? "dark" : "light", url: base },
          ]);
          await context.route("**/*", (route) => {
            const url = new URL(route.request().url());
            return url.origin === base ? route.continue() : route.abort();
          });
          const page = await context.newPage();
          page.on("pageerror", (error) => errors.push(error.message));
          for (const id of legalDocumentIds) {
            const response = await page.goto(`${base}/legal/${id}`, { waitUntil: "networkidle" });
            assert.equal(response?.status(), 200, `${locale}/${id}`);
            assert.equal(
              await page.locator("h1").textContent(),
              legalCopy[locale].documents[id].title,
            );
            assert.equal(
              await page.locator('[role="note"]').textContent(),
              legalCopy[locale].draftNotice,
            );
            assert(
              (await page.locator('meta[name="robots"]').getAttribute("content"))?.includes(
                "noindex",
              ),
            );
            assert.equal(await page.locator("[data-seller-field]").count(), 14);
            assert.equal(
              await page.locator('a[aria-current="page"]').getAttribute("href"),
              `/legal/${id}`,
            );
            const layout = await page.evaluate(() => ({
              overflow: document.documentElement.scrollWidth - window.innerWidth,
              dark: document.documentElement.classList.contains("dark"),
              missingAnchors: [
                ...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'),
              ].filter((a) => !document.getElementById(a.hash.slice(1))).length,
            }));
            assert(layout.overflow <= 1, JSON.stringify({ locale, width, id, layout }));
            assert.equal(layout.dark, dark);
            assert.equal(layout.missingAnchors, 0);
            await page.locator('a[href="#seller-details"]').click();
            assert(await page.locator("#seller-details").isVisible());
            await page.evaluate(() => window.scrollTo(0, 0));
            const tag = `${locale}-${id}-${width}-${dark ? "dark" : "light"}`;
            if (
              (locale === "ru" && id === "offer" && width === 1440) ||
              (locale === "ru" && id === "refunds" && width === 390 && !dark) ||
              (locale === "kg" && id === "payment" && width === 390 && !dark)
            ) {
              const filename = `${tag}.png`;
              await page.screenshot({ path: path.join(dir, filename) });
              screenshots.push(filename);
            }
            results.push({ tag, status: response?.status(), ...layout });
          }
          // Exercise actual navigation and the reused language switcher, not only direct requests.
          await page.locator('a[href="/legal/refunds"]').first().click();
          await page.waitForURL("**/legal/refunds");
          assert.equal(
            await page.locator("h1").textContent(),
            legalCopy[locale].documents.refunds.title,
          );
          if (locale === "ru" && width === 1440 && !dark) {
            await page.locator("select").selectOption("en");
            await page
              .getByRole("heading", { name: legalCopy.en.documents.refunds.title, exact: true })
              .waitFor();
            assert.equal(
              await context
                .cookies()
                .then((cookies) => cookies.find((c) => c.name === "NEXT_LOCALE")?.value),
              "en",
            );
          }
          await context.close();
        }
      }
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(dir, "browser.json"),
      JSON.stringify({ results, errors, screenshots }, null, 2),
    );
    console.log(
      `PASS: ${results.length} page states, document navigation and locale switching; ${screenshots.length} screenshots`,
    );
  } finally {
    await browser.close();
  }
}
