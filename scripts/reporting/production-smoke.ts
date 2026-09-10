/** Exact-SHA smoke. Synthetic documents in a dedicated QA organization; no payment/fiscal/email providers. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { chromium, type BrowserContext } from "playwright";
import { businessDateKey } from "../../src/lib/timezone";
const sha = process.argv.find((arg) => arg.startsWith("--sha="))?.slice(6);
if (!sha || !/^[a-f0-9]{40}$/.test(sha)) throw Error("An exact --sha= is required");
const base = "https://www.bazaar.kg",
  output = "artifacts/reporting/production";
async function checkSha() {
  const response = await fetch(`${base}/api/version`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sha, sha);
}
await checkSha();
const config = parseEnv(await readFile(".vercel/.env.production.local", "utf8"));
if (!config.DATABASE_URL) throw Error("Existing production database connection required");
const db = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
const runId = randomUUID(),
  password = randomBytes(32).toString("base64url");
const browser = await chromium.launch();
const report: {
  sha: string;
  runId: string;
  status: string;
  checks: string[];
  organizationId?: string;
  usersDisabled?: boolean;
  error?: string;
} = { sha, runId, status: "running", checks: [] };
let users: Array<{ id: string; email: string; role: string }> = [];
await mkdir(output, { recursive: true });
async function login(email: string) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
  );
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ru", url: base }]);
  const { csrfToken } = await (await context.request.get(base + "/api/auth/csrf")).json();
  await context.request.post(base + "/api/auth/callback/credentials", {
    form: { csrfToken, email, password, json: "true", callbackUrl: base },
  });
  assert.ok((await (await context.request.get(base + "/api/auth/session")).json()).user?.id);
  return context;
}
async function api(context: BrowserContext, method: string, input: unknown) {
  const response = await context.request.get(
    `${base}/api/trpc/${method}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
  );
  const data = await response.json();
  if (data.error) throw Error(JSON.stringify(data.error));
  return data.result.data.json;
}
try {
  const pending = await db.$queryRaw<
    Array<{ count: bigint }>
  >`SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
  assert.equal(Number(pending[0].count), 0);
  report.checks.push("Exact SHA and no unfinished database migrations");
  const passwordHash = await bcrypt.hash(password, 12),
    at = new Date(Date.now() - 5000);
  const fixture = await db.$transaction(
    async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: `INTERNAL QA REPORT ${sha.slice(0, 8)} ${runId.slice(0, 8)}`,
          plan: "ENTERPRISE",
        },
      });
      const store = await tx.store.create({
        data: { organizationId: org.id, name: "Отчёты · тестовая организация", code: "QA" },
      });
      const unit = await tx.unit.create({
        data: { organizationId: org.id, code: "each", labelRu: "шт", labelKg: "даана" },
      });
      const actors = [];
      for (const role of ["ADMIN", "MANAGER", "STAFF", "CASHIER"] as const) {
        const user = await tx.user.create({
          data: {
            organizationId: org.id,
            name: `Report QA ${role}`,
            email: `report-${role.toLowerCase()}-${runId}@example.invalid`,
            passwordHash,
            role,
            isOrgOwner: role === "ADMIN",
            emailVerifiedAt: new Date(),
          },
        });
        await tx.userStoreAccess.create({
          data: { organizationId: org.id, userId: user.id, storeId: store.id },
        });
        await tx.userGuideState.create({
          data: {
            userId: user.id,
            completedToursJson: [],
            dismissedTipsJson: ["__guidance:tours_disabled__"],
          },
        });
        actors.push(user);
      }
      const make = (name: string, sku: string) =>
        tx.product.create({
          data: {
            organizationId: org.id,
            name,
            sku,
            unit: unit.code,
            baseUnitId: unit.id,
            basePriceKgs: 100,
          },
        });
      const tea = await make("QA · историческая стоимость", "QA-HISTORY"),
        gift = await make("QA · нулевая стоимость", "QA-ZERO"),
        unknown = await make("QA · нет стоимости", "QA-UNKNOWN");
      for (const product of [tea, gift, unknown]) {
        await tx.storeProduct.create({
          data: { organizationId: org.id, storeId: store.id, productId: product.id },
        });
        await tx.inventorySnapshot.create({
          data: { storeId: store.id, productId: product.id, onHand: 0 },
        });
      }
      await tx.productCost.createMany({
        data: [
          { organizationId: org.id, productId: tea.id, avgCostKgs: 999, costBasisQty: 1 },
          { organizationId: org.id, productId: gift.id, avgCostKgs: 0, costBasisQty: 1 },
          { organizationId: org.id, productId: unknown.id, avgCostKgs: 50, costBasisQty: 1 },
        ],
      });
      const register = await tx.posRegister.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          code: "QA",
          name: "QA · без внешних операций",
        },
      });
      const shift = await tx.registerShift.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          registerId: register.id,
          openedById: actors[0].id,
        },
      });
      const sale = await tx.customerOrder.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          registerId: register.id,
          shiftId: shift.id,
          number: "QA-REPORT-POS",
          isPosSale: true,
          status: "COMPLETED",
          completedAt: at,
          createdById: actors[0].id,
          subtotalKgs: 100,
          discountKgs: 10,
          totalKgs: 90,
          lines: {
            create: [
              {
                productId: tea.id,
                qty: 2,
                unitPriceKgs: 40,
                lineTotalKgs: 80,
                unitCostKgs: 10,
                lineCostTotalKgs: 20,
              },
              {
                productId: gift.id,
                qty: 1,
                unitPriceKgs: 20,
                lineTotalKgs: 20,
                unitCostKgs: 0,
                lineCostTotalKgs: 0,
              },
            ],
          },
        },
        include: { lines: true },
      });
      await tx.customerOrder.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          number: "QA-REPORT-MISSING",
          isPosSale: true,
          status: "COMPLETED",
          completedAt: at,
          subtotalKgs: 80,
          totalKgs: 80,
          lines: { create: { productId: unknown.id, qty: 1, unitPriceKgs: 80, lineTotalKgs: 80 } },
        },
      });
      await tx.customerOrder.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          number: "QA-REPORT-ORDER",
          status: "COMPLETED",
          completedAt: at,
          subtotalKgs: 50,
          totalKgs: 50,
          lines: {
            create: {
              productId: tea.id,
              qty: 1,
              unitPriceKgs: 50,
              lineTotalKgs: 50,
              unitCostKgs: 12,
              lineCostTotalKgs: 12,
            },
          },
        },
      });
      const originalLine = sale.lines.find((line) => line.productId === tea.id)!;
      const returned = await tx.saleReturn.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          registerId: register.id,
          shiftId: shift.id,
          originalSaleId: sale.id,
          number: "QA-REPORT-RETURN",
          status: "COMPLETED",
          completedAt: at,
          createdById: actors[0].id,
          totalKgs: 36,
          subtotalKgs: 36,
          lines: {
            create: {
              customerOrderLineId: originalLine.id,
              productId: tea.id,
              qty: 1,
              unitPriceKgs: 36,
              lineTotalKgs: 36,
              unitCostKgs: 10,
              lineCostTotalKgs: 10,
            },
          },
        },
      });
      await tx.salePayment.createMany({
        data: [
          {
            organizationId: org.id,
            storeId: store.id,
            shiftId: shift.id,
            customerOrderId: sale.id,
            method: "CASH",
            amountKgs: 34,
            createdAt: at,
          },
          {
            organizationId: org.id,
            storeId: store.id,
            shiftId: shift.id,
            customerOrderId: sale.id,
            method: "CARD",
            amountKgs: 56,
            createdAt: at,
          },
          {
            organizationId: org.id,
            storeId: store.id,
            shiftId: shift.id,
            customerOrderId: sale.id,
            saleReturnId: returned.id,
            method: "CASH",
            amountKgs: 36,
            isRefund: true,
            createdAt: at,
          },
        ],
      });
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          actorId: actors[0].id,
          action: "REPORT_QA_CREATE",
          entity: "Organization",
          entityId: org.id,
          requestId: runId,
          after: { sha, isolated: true, externalEffects: false },
        },
      });
      return { org, store, users: actors, tea, sale };
    },
    { timeout: 30000 },
  );
  report.organizationId = fixture.org.id;
  users = fixture.users;
  const period = {
    dateFrom: businessDateKey(at),
    dateTo: businessDateKey(new Date()),
    channel: "all" as const,
  };
  const admin = await login(users[0].email),
    page = await admin.newPage();
  page.setDefaultTimeout(45000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const sales = await api(admin, "reports.sales", period);
  assert.equal(sales.totals.netSalesKgs, 184);
  assert.equal(sales.totals.knownCostKgs, 22);
  assert.equal(sales.totals.knownProfitKgs, 82);
  assert.equal(sales.totals.grossProfitKgs, null);
  assert.equal(sales.totals.unknownCostLines, 1);
  assert.equal(sales.totals.zeroCostLines, 1);
  const inventory = await api(admin, "adminMetrics.get", {});
  assert.equal(inventory.sales30d.revenueKgs, 184);
  assert.equal(inventory.sales30d.unknownCostLines, 1);
  const payments = await api(admin, "reports.operations", {
    dateFrom: period.dateFrom,
    dateTo: period.dateTo,
    view: "payments",
  });
  assert.equal(payments.summary.amountKgs, 54);
  assert.equal(payments.summary.count, 3);
  report.checks.push(
    "Production SQL: sale/order/partial return, discounts, split payments, zero and missing cost, historical price; admin totals reconcile",
  );
  const known = await api(admin, "reports.sales", { ...period, search: "QA-HISTORY" });
  assert.equal(known.totals.netSalesKgs, 86);
  assert.equal(known.totals.costKgs, 22);
  assert.equal(known.totals.grossProfitKgs, 64);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(
      `${base}/reports/analytics?${new URLSearchParams({ ...period, search: "QA-HISTORY" })}`,
    );
    await page
      .getByText(/Обновлено/)
      .first()
      .waitFor();
    await page.locator(".recharts-surface").first().waitFor();
    await page.screenshot({ path: `${output}/analytics-known-cost-${width}.png`, fullPage: true });
  }
  for (const width of [390, 1440])
    for (const path of ["/reports", "/reports/analytics", "/admin/metrics"]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(
        base + path + (path === "/admin/metrics" ? "" : `?${new URLSearchParams(period)}`),
      );
      await page
        .getByText(/Обновлено/)
        .first()
        .waitFor();
      if (path === "/reports/analytics") await page.locator(".recharts-surface").first().waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({
        path: `${output}/${path.slice(1).replaceAll("/", "-")}-${width}.png`,
        fullPage: true,
      });
    }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/reports/analytics?${new URLSearchParams(period)}`);
  await page.getByRole("button", { name: fixture.tea.name, exact: true }).click();
  await page.getByRole("button", { name: "QA-REPORT-POS", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.reload();
  await page
    .getByText(/Обновлено/)
    .first()
    .waitFor();
  assert.equal(new URL(page.url()).searchParams.get("productId"), fixture.tea.id);
  const exported = await api(admin, "reports.salesExport", period);
  assert.equal(exported.items.length, 3);
  assert.equal(exported.totals.netSalesKgs, 184);
  report.checks.push(
    "All three production pages, real charts, mobile layout, source receipt, reload and full export",
  );
  for (const user of users.slice(1)) {
    const context = await login(user.email),
      tab = await context.newPage();
    for (const path of ["/reports", "/reports/analytics", "/admin/metrics"]) {
      await tab.goto(base + path);
      await tab.locator("main").first().waitFor();
      assert.equal(
        new URL(tab.url()).pathname,
        user.role === "MANAGER" ? (path === "/admin/metrics" ? "/dashboard" : path) : "/pos",
      );
    }
    const response = await context.request.get(
      `${base}/api/trpc/adminMetrics.get?input=${encodeURIComponent(JSON.stringify({ json: {} }))}`,
    );
    assert.equal(response.status(), 403);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await checkSha();
  report.status = "passed";
  report.checks.push("ADMIN/MANAGER/STAFF/CASHIER UI and server access; final exact SHA rechecked");
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  if (users.length) {
    await db.user.updateMany({
      where: { id: { in: users.map((user) => user.id) }, organizationId: report.organizationId },
      data: { isActive: false, sessionVersion: { increment: 1 } },
    });
    report.usersDisabled = true;
  }
  if (report.organizationId)
    await db.auditLog.create({
      data: {
        organizationId: report.organizationId,
        actorId: users[0]?.id,
        action: "REPORT_QA_FINISH",
        entity: "Organization",
        entityId: report.organizationId,
        requestId: runId,
        after: { sha, status: report.status, usersDisabled: report.usersDisabled ?? false },
      },
    });
  await db.$disconnect();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
}
