import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type BrowserContext, type Page } from "playwright";

export type ShiftCloseFixture = {
  organizationId: string;
  storeId: string;
  productId: string;
  users: Array<{ role: "ADMIN" | "MANAGER" | "CASHIER"; email: string; password: string }>;
};

/** Only call with isolated fixture accounts: creates synthetic internal sales, never provider calls. */
export async function verifyShiftClosing(base: string, fixture: ShiftCloseFixture, output: string) {
  await mkdir(output, { recursive: true });
  const copy = JSON.parse(await readFile("messages/ru.json", "utf8")).pos;
  const browser = await chromium.launch();
  const checks: string[] = [];
  const operations: Array<{ role: string; registerId: string; shiftId: string; saleId: string }> =
    [];
  const contexts = new Map<string, BrowserContext>();
  let page: Page | undefined;
  const record = (message: string) => {
    checks.push(message);
    console.log(`PASS ${message}`);
  };
  async function api(context: BrowserContext, name: string, input: unknown, mutation = false) {
    const response = mutation
      ? await context.request.post(`${base}/api/trpc/${name}`, { data: { json: input } })
      : await context.request.get(
          `${base}/api/trpc/${name}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
        );
    const body = await response.json();
    if (body.error) throw new Error(body.error.json.message);
    return body.result.data.json;
  }
  try {
    for (const user of fixture.users) {
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: user.role === "MANAGER" ? 390 : 1440, height: 1000 },
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
          email: user.email,
          password: user.password,
          json: "true",
          callbackUrl: base,
        },
      });
      const session = await (await context.request.get(base + "/api/auth/session")).json();
      assert.equal(session.user?.role, user.role);
      assert.equal(session.user?.organizationId, fixture.organizationId);
      contexts.set(user.role, context);
    }
    const admin = contexts.get("ADMIN")!;
    assert(admin, "Fixture needs an administrator to create isolated registers");
    for (const role of ["CASHIER", "MANAGER", "ADMIN"]) {
      const context = contexts.get(role)!;
      const register = await api(
        admin,
        "pos.registers.create",
        {
          storeId: fixture.storeId,
          name: `Shift close QA ${role}`,
          code: `QA-${randomUUID().slice(0, 8)}`,
        },
        true,
      );
      const shift = await api(
        context,
        "pos.shifts.open",
        { registerId: register.id, openingCashKgs: 0, idempotencyKey: randomUUID() },
        true,
      );
      async function draft(qty: number) {
        const sale = await api(
          context,
          "pos.sales.createDraft",
          {
            registerId: register.id,
            ...(qty ? { lines: [{ productId: fixture.productId, qty }] } : {}),
          },
          true,
        );
        if (qty) {
          const detail = await api(context, "pos.sales.get", { saleId: sale.id });
          await api(
            context,
            "pos.sales.updateLine",
            { lineId: detail.lines[0].id, unitPriceKgs: 100 },
            true,
          );
        }
        return sale;
      }
      const held = await draft(2);
      await api(context, "pos.sales.holdDraft", { saleId: held.id }, true);
      const active = await draft(role === "CASHIER" ? 1 : 0);
      page = await context.newPage();
      page.setDefaultTimeout(45_000);
      page.on("dialog", (dialog) => dialog.accept());
      const runtimeErrors: string[] = [];
      page.on("pageerror", (error) => runtimeErrors.push(error.message));
      if (role === "CASHIER") {
        await page.goto(
          `${base}/pos/sell?registerId=${register.id}&receiptId=${held.id}&mode=resume&from=shift-close`,
        );
        await page.locator("[data-pos-resume-gate] [role=alert]").waitFor();
        assert.equal(
          await page.getByRole("button", { name: copy.sell.completeSale, exact: true }).count(),
          0,
        );
        await page
          .getByRole("heading", { name: copy.sell.receiptNotOpened, exact: true })
          .waitFor();
        await page.screenshot({ path: `${output}/resume-conflict.png` });
        await page.getByRole("link", { name: copy.shifts.returnToClose, exact: true }).click();
        record("conflicting resume cannot sell a different receipt");
      } else {
        await page.goto(`${base}/pos/shifts?registerId=${register.id}#shift-close`);
      }
      const activeRow = page.locator(`[data-shift-receipt="${active.id}"]`);
      const heldRow = page.locator(`[data-shift-receipt="${held.id}"]`);
      await activeRow.waitFor();
      await heldRow.waitFor();
      assert.equal(
        await heldRow.getByRole("link", { name: copy.shifts.continueReceipt, exact: true }).count(),
        0,
      );
      await heldRow.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/${role}-blockers.png` });
      assert(!(await page.locator("body").innerText()).includes("[[missing:"));
      if (role === "CASHIER") {
        for (const [locale, width] of [
          ["kg", 390],
          ["en", 768],
          ["ru", 360],
        ] as const) {
          const localized = JSON.parse(await readFile(`messages/${locale}.json`, "utf8")).pos;
          await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: base }]);
          await page.setViewportSize({ width, height: 1000 });
          await page.reload();
          await heldRow
            .getByRole("button", { name: localized.sell.discardSale, exact: true })
            .waitFor();
          await heldRow.scrollIntoViewIfNeeded();
          assert(!(await page.locator("body").innerText()).includes("[[missing:"));
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          await page.screenshot({ path: `${output}/blockers-${locale}-${width}.png` });
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        record("RU/KG/EN blocker cards and 360/390/768/1440 px layouts");
      }
      await activeRow.getByRole("button", { name: copy.sell.discardSale, exact: true }).click();
      await activeRow.waitFor({ state: "hidden" });
      assert.equal((await api(context, "pos.sales.get", { saleId: active.id })).status, "CANCELED");
      await heldRow.getByRole("link", { name: copy.shifts.continueReceipt, exact: true }).click();
      await page.waitForURL((url) => url.pathname === "/pos/sell" && !url.searchParams.has("mode"));
      if (role === "MANAGER")
        await page.getByRole("button", { name: copy.sell.mobile.payment, exact: true }).click();
      const completed = page.waitForResponse(
        (response) =>
          response.url().includes("pos.sales.complete") && response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: copy.sell.completeSale, exact: true })
        .filter({ visible: true })
        .click();
      assert.equal((await completed).status(), 200);
      assert.equal((await api(context, "pos.sales.get", { saleId: held.id })).status, "COMPLETED");
      record(`${role}: original held receipt completed at 200 KGS`);
      if (role === "MANAGER")
        await page.getByRole("button", { name: copy.shifts.returnToClose, exact: true }).click();
      else await page.getByRole("link", { name: copy.shifts.returnToClose, exact: true }).click();
      await page.getByRole("button", { name: copy.shifts.closeShift, exact: true }).waitFor();
      await page.waitForFunction(
        () => document.querySelectorAll("[data-shift-receipt]").length === 0,
      );
      // Another browser tab cancels a new draft while the closing screen remains mounted.
      const empty = await draft(0);
      await page.locator(`[data-shift-receipt="${empty.id}"]`).waitFor();
      let releaseOldSnapshot: (() => void) | undefined;
      let oldSnapshotDelivered: Promise<void> | undefined;
      if (role === "CASHIER") {
        let captured!: () => void;
        const oldSnapshotCaptured = new Promise<void>((resolve) => {
          captured = resolve;
        });
        const hold = new Promise<void>((resolve) => {
          releaseOldSnapshot = resolve;
        });
        let delivered!: () => void;
        oldSnapshotDelivered = new Promise<void>((resolve) => {
          delivered = resolve;
        });
        let intercepted = false;
        await page.route(
          (url) => url.pathname.includes("pos.shifts.current"),
          async (route) => {
            if (intercepted) return route.fallback();
            intercepted = true;
            const response = await route.fetch();
            assert((await response.text()).includes(empty.id));
            captured();
            await hold;
            // Query cancellation may already have aborted this browser request.
            await route.fulfill({ response }).catch(() => undefined);
            delivered();
          },
        );
        await oldSnapshotCaptured;
      }
      const otherTab = await context.newPage();
      otherTab.setDefaultTimeout(45_000);
      otherTab.on("dialog", (dialog) => dialog.accept());
      await otherTab.goto(`${base}/pos/shifts?registerId=${register.id}#shift-close`);
      await otherTab
        .locator(`[data-shift-receipt="${empty.id}"]`)
        .getByRole("button", { name: copy.sell.discardSale, exact: true })
        .click();
      await otherTab.locator(`[data-shift-receipt="${empty.id}"]`).waitFor({ state: "hidden" });
      await page.bringToFront();
      await page.locator(`[data-shift-receipt="${empty.id}"]`).waitFor({ state: "hidden" });
      await otherTab.close();
      if (releaseOldSnapshot) {
        releaseOldSnapshot();
        await oldSnapshotDelivered;
        await page.waitForTimeout(200);
        assert.equal(await page.locator(`[data-shift-receipt="${empty.id}"]`).count(), 0);
        record("late pre-cancellation response cannot restore a resolved warning");
      }
      record(`${role}: other-tab cancellation refreshed the open closing screen`);
      await page.getByPlaceholder(copy.shifts.countedCash, { exact: true }).fill("200");
      await page.getByLabel(copy.shifts.confirmClose, { exact: true }).check();
      let closeInput: Record<string, unknown> | undefined;
      await page.route("**/api/trpc/pos.shifts.close*", async (route) => {
        const body = route.request().postDataJSON();
        closeInput = body["0"]?.json ?? body.json;
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        if (role === "CASHIER") await route.abort("failed");
        else await route.fulfill({ response });
      });
      await page.getByRole("button", { name: copy.shifts.closeShift, exact: true }).click();
      await page.getByText(copy.shifts.closedSuccess, { exact: true }).waitFor();
      assert(closeInput);
      await api(context, "pos.shifts.close", closeInput, true);
      const report = await api(context, "pos.shifts.xReport", { shiftId: shift.id });
      assert.equal(report.shift.status, "CLOSED");
      assert.equal(report.shift.expectedCashKgs, 200);
      assert.equal(report.shift.closingCashCountedKgs, 200);
      assert.equal(report.summary.salesCount, 1);
      assert.equal((await api(context, "pos.sales.get", { saleId: held.id })).payments.length, 1);
      await page.screenshot({ path: `${output}/${role}-closed.png`, fullPage: true });
      assert.deepEqual(runtimeErrors, []);
      operations.push({ role, registerId: register.id, shiftId: shift.id, saleId: held.id });
      record(
        `${role}: shift closed once with correct totals${role === "CASHIER" ? "; lost response recovered" : ""}`,
      );
      await page.close();
      page = undefined;
    }
    await writeFile(
      `${output}/report.json`,
      JSON.stringify({ status: "passed", checks, operations }, null, 2),
    );
    return { checks, operations };
  } catch (error) {
    await page
      ?.screenshot({ path: `${output}/failure.png`, fullPage: true })
      .catch(() => undefined);
    await writeFile(
      `${output}/report.json`,
      JSON.stringify({ status: "failed", error: String(error), checks, operations }, null, 2),
    );
    throw error;
  } finally {
    await browser.close();
  }
}
