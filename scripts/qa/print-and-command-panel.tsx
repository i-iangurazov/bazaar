/** Run against `pnpm dev:stabilization` after `pnpm test:stabilization:seed`.
 * No forms are submitted. Operational writes and external requests are blocked;
 * only authentication and tutorial preference synchronization are permitted.
 * PDFs and a JSON manifest are written for visual / verify-movement-pdfs.py checks.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { MovementPrintDocument } from "../../src/components/inventory/movement-print-document";
import {
  movementPrintFixture,
  movementPrintLabels,
} from "../../tests/helpers/movementPrintFixture";
import { printableMovementTypes } from "../../src/lib/movementPrint";
import {
  commandDestination,
  commandDestinations,
  canNavigateCommand,
  type CommandId,
} from "../../src/lib/commandPaletteNavigation";
import ru from "../../messages/ru.json";

Object.assign(globalThis, { React });
const base = "http://localhost:3108";
const dir = path.resolve(process.env.QA_OUTPUT_DIR || "artifacts/movement-print-command/latest");
fs.mkdirSync(dir, { recursive: true });
const printOnly = process.env.QA_PRINT_ONLY === "1";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.QA_BROWSER_CHANNEL ? { channel: process.env.QA_BROWSER_CHANNEL } : {}),
});
const evidence: {
  checks: unknown[];
  pdfs: unknown[];
  errors: string[];
  blockedWrites: string[];
  result?: string;
} = { checks: [], pdfs: [], errors: [], blockedWrites: [] };
const save = () =>
  fs.writeFileSync(path.join(dir, "browser.json"), JSON.stringify(evidence, null, 2));
const check = (name: string, details: object = {}) => {
  evidence.checks.push({ name, ...details, result: "PASS" });
  save();
  console.log(name);
};
try {
  const context = await browser.newContext();
  let css: string;
  if (process.env.QA_PRINT_CSS) {
    css = fs.readFileSync(process.env.QA_PRINT_CSS, "utf8");
  } else {
    const login = await (await context.request.get(base + "/login")).text();
    const stylesheets = [...login.matchAll(/href="([^"]+\.css(?:\?[^"]*)?)"/g)].map((match) =>
      match[1].replaceAll("&amp;", "&"),
    );
    assert(stylesheets.length, "Load real compiled application CSS, including dark mode");
    css = (
      await Promise.all(
        stylesheets.map(async (href) =>
          (await context.request.get(new URL(href, base).href)).text(),
        ),
      )
    ).join("\n");
  }
  for (const type of process.env.QA_NAVIGATION_ONLY === "1" ? [] : printableMovementTypes) {
    const count = 90;
    const markup = renderToStaticMarkup(
      <MovementPrintDocument
        document={movementPrintFixture(type, count)}
        labels={{
          ...movementPrintLabels,
          title:
            type === "TRANSFER"
              ? ru.inventory.movementJournal.printTransferTitle
              : type === "WRITE_OFF"
                ? ru.inventory.movementJournal.printWriteOffTitle
                : type === "ADJUSTMENT"
                  ? ru.inventory.movementJournal.type.ADJUSTMENT
                  : ru.inventory.movementJournal.printReceivingTitle,
        }}
        locale="ru"
      />,
    );
    for (const dark of [true, false])
      for (const backgrounds of [true, false]) {
        const tag = `${type}-${dark ? "dark" : "light"}-${backgrounds ? "bg" : "no-bg"}`;
        const page = await context.newPage();
        await page.route("**/*", (route) => route.abort());
        await page.setContent(
          `<!doctype html><html class="${dark ? "dark" : ""}"><head><meta charset="utf-8"><style>${css}</style></head><body class="font-sans min-h-screen bg-gradient-to-br from-background via-background to-secondary/40"><main class="movement-print-page min-h-screen bg-slate-100 py-1 print:bg-white"><div class="movement-print-chrome sticky top-0 z-10 border-b bg-background/95 backdrop-blur" data-print-exclude="true">PRINT TOOLBAR MUST BE HIDDEN</div>${markup}</main><div style="position:fixed;bottom:0;background:black">OUTSIDE DOCUMENT MUST BE HIDDEN</div></body></html>`,
        );
        const screenScheme = await page.evaluate(
          () => getComputedStyle(document.documentElement).colorScheme,
        );
        assert.equal(screenScheme, dark ? "dark" : "light");
        await page.evaluate(() => window.scrollTo(0, 800));
        await page.emulateMedia({ media: "print" });
        const result = await page.evaluate(() => {
          const sheet = document.querySelector(".movement-print-sheet")!;
          const cell = document.querySelector("tbody tr:nth-child(2) td")!;
          const style = getComputedStyle(cell);
          return {
            scheme: getComputedStyle(document.documentElement).colorScheme,
            background: getComputedStyle(document.body).backgroundColor,
            image: getComputedStyle(document.body).backgroundImage,
            color: style.color,
            shadow: getComputedStyle(sheet).boxShadow,
            padding: parseFloat(style.paddingTop),
            lineHeight: parseFloat(style.lineHeight),
            border: parseFloat(style.borderTopWidth),
            shortRowHeight: cell.getBoundingClientRect().height,
            positioned: [...document.querySelectorAll("*")]
              .filter(
                (element) =>
                  getComputedStyle(element).display !== "none" &&
                  element.getBoundingClientRect().height > 0 &&
                  ["fixed", "sticky"].includes(getComputedStyle(element).position),
              )
              .map((element) => ({
                tag: element.tagName,
                className: element.className,
                display: getComputedStyle(element).display,
              })),
            text: sheet.textContent,
            header: getComputedStyle(document.querySelector("thead")!).display,
            rowBreak: getComputedStyle(cell.closest("tr")!).breakInside,
          };
        });
        assert.equal(result.scheme, "light");
        assert.equal(result.background, "rgb(255, 255, 255)");
        assert.equal(result.image, "none");
        assert.equal(result.color, "rgb(0, 0, 0)");
        assert.equal(result.shadow, "none");
        assert.deepEqual(result.positioned, []);
        assert.equal(result.header, "table-header-group");
        assert.equal(result.rowBreak, "avoid");
        assert(result.border > 0 && result.border <= 1);
        assert(
          result.padding <= 4 && result.lineHeight <= 13 && result.shortRowHeight < 24,
          JSON.stringify({ ...result, text: undefined }),
        );
        assert(!/SKU-ONLY-IN-DATA|999000|штрихкод/.test(result.text || ""));
        const file = `${tag}.pdf`;
        await page.pdf({
          path: path.join(dir, file),
          format: "A4",
          preferCSSPageSize: true,
          printBackground: backgrounds,
          displayHeaderFooter: false,
        });
        evidence.pdfs.push({ file, type, count, dark, backgrounds });
        await page.emulateMedia({ media: "screen" });
        assert.equal(
          await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
          screenScheme,
        );
        check(`A4 print ${tag}`, { ...result, text: undefined });
        await page.close();
      }
  }
  await context.close();

  if (!printOnly) {
    const fixture = JSON.parse(
      fs.readFileSync("artifacts/bazaar-stabilization/browser-fixture.json", "utf8"),
    );
    assert.equal(fixture.syntheticOnly, true);
    assert.equal(fixture.database, "127.0.0.1:55432/bazaar_hardening_ci");
    const ids = Object.keys(commandDestinations) as CommandId[];
    const dialogs: Partial<Record<CommandId, string>> = {
      "inventory-count": ru.stockCounts.create,
      "new-customer": ru.customers.modal.addTitle,
      "new-supplier": ru.suppliers.newSupplier,
      "new-store": ru.stores.addStore,
      "new-employee": ru.users.addUser,
    };
    for (const role of ["ADMIN", "MANAGER", "STAFF", "CASHIER"]) {
      const storeId = fixture.stores[role === "ADMIN" ? 1 : 0].id;
      const sessionContext = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        serviceWorkers: "block",
      });
      await sessionContext.addCookies([{ name: "NEXT_LOCALE", value: "ru", url: base }]);
      const { csrfToken } = await (
        await sessionContext.request.get(base + "/api/auth/csrf")
      ).json();
      await sessionContext.request.post(base + "/api/auth/callback/credentials", {
        form: {
          csrfToken,
          email: fixture.users[role].email,
          password: fixture.password,
          json: "true",
        },
        maxRedirects: 0,
      });
      assert.equal(
        (await (await sessionContext.request.get(base + "/api/auth/session")).json()).user?.role,
        role,
      );
      await sessionContext.route("**/*", async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (url.origin !== base) return route.abort();
        if (
          !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
          !url.pathname.startsWith("/api/auth/") &&
          url.pathname !== "/api/trpc/guidance.syncState"
        ) {
          evidence.blockedWrites.push(url.pathname);
          save();
          return route.abort();
        }
        return route.continue();
      });
      const page = await sessionContext.newPage();
      page.setDefaultTimeout(30000);
      page.on("pageerror", (error) => {
        evidence.errors.push(`${role} ${page.url()}: ${error.stack || error.message}`);
        save();
      });
      const allowed = ids.filter((id) => canNavigateCommand({ role }, commandDestination(id)));
      for (const id of allowed) {
        await page.goto(
          `${base}/settings/profile?storeId=${storeId}&organizationId=ignored&warehouseId=ignored`,
          { waitUntil: "networkidle", timeout: 90000 },
        );
        await page.getByRole("button", { name: ru.commandPalette.openButton, exact: true }).click();
        const panel = page.getByRole("dialog", { name: ru.commandPalette.title, exact: true });
        await panel.waitFor();
        const visible = await panel
          .locator("[data-command-id]:visible")
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute("data-command-id")),
          );
        assert.deepEqual(visible.sort(), [...allowed].sort(), `${role} visible commands`);
        const expected = new URL(commandDestination(id, { storeId }).href, base);
        await panel.locator(`[data-command-id="${id}"]:visible`).click();
        await page.waitForURL((url) => url.pathname === expected.pathname, { timeout: 90000 });
        if (dialogs[id])
          await page.getByRole("dialog", { name: dialogs[id], exact: true }).waitFor();
        else {
          if (id === "create-sale-order")
            await page.getByTestId("pos-receipt-journal-open").waitFor();
          else await page.locator("main h1:visible, main h2:visible").first().waitFor();
          const actual = new URL(page.url());
          for (const [key, value] of expected.searchParams)
            assert.equal(actual.searchParams.get(key), value, `${id}: ${key}`);
          assert.equal(actual.hash, expected.hash);
        }
        const actual = new URL(page.url());
        if (expected.searchParams.has("storeId"))
          assert.equal(actual.searchParams.get("storeId"), storeId);
        assert(
          !actual.searchParams.has("organizationId") && !actual.searchParams.has("warehouseId"),
        );
        assert(!(await page.locator("body").innerText()).includes("NEXT_NOT_FOUND"));
        check(`${role}: ${id}`, {
          expected: expected.pathname + expected.search + expected.hash,
          actual: actual.pathname + actual.search + actual.hash,
          creationDialog: Boolean(dialogs[id]),
        });
        if (id.startsWith("inventory-") || dialogs[id])
          await page.screenshot({ path: path.join(dir, `${role}-${id}.png`) });
      }
      // The legacy alias must now open the same creation form.
      if (role === "ADMIN") {
        await page.goto(base + `/inventory/counts/new?storeId=${storeId}`, {
          waitUntil: "networkidle",
          timeout: 90000,
        });
        await page.getByRole("dialog", { name: ru.stockCounts.create, exact: true }).waitFor();
        check("Stock count legacy alias opens creation form");
        await page.keyboard.press("Escape");
        await page
          .getByRole("dialog", { name: ru.stockCounts.create, exact: true })
          .waitFor({ state: "hidden" });
        await page.reload({ waitUntil: "networkidle" });
        await page
          .getByRole("dialog", { name: ru.stockCounts.create, exact: true })
          .waitFor({ state: "hidden" });
        check("Consumed stock count creation link stays closed after refresh");
      }
      await sessionContext.close();
    }
  }
  assert.deepEqual(evidence.errors, []);
  assert.deepEqual(
    evidence.blockedWrites,
    [],
    "Navigation should not submit operational mutations",
  );
  evidence.result = "PASS";
  save();
} catch (error) {
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .at(-1);
  if (page) {
    await page.screenshot({ path: path.join(dir, "failure.png") }).catch(() => {});
    fs.writeFileSync(
      path.join(dir, "failure-page.txt"),
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
  }
  evidence.result = "FAIL";
  evidence.errors.push(String(error));
  save();
  throw error;
} finally {
  await browser.close();
}
