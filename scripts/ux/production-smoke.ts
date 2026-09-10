/** Exact-SHA UI smoke. Only synthetic organization and products; no sales, payments or mail. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";

const expectedSha = process.argv.find((arg) => arg.startsWith("--sha="))?.slice(6);
if (!expectedSha || !/^[a-f0-9]{40}$/.test(expectedSha))
  throw new Error("An exact --sha= is required");
const base = "https://www.bazaar.kg";
async function checkRelease() {
  const response = await fetch(`${base}/api/version`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).sha,
    expectedSha,
    "Production alias must serve the requested SHA",
  );
}
await checkRelease();
await mkdir("artifacts/ux/production", { recursive: true });
// Use the existing configured connection in memory; do not download/copy secrets.
const config = parseEnv(await readFile(".vercel/.env.production.local", "utf8"));
if (!config.DATABASE_URL) throw new Error("No existing production database connection");
const db = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
const runId = randomUUID();
const password = randomBytes(32).toString("base64url");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.UI_BROWSER_CHANNEL ? { channel: process.env.UI_BROWSER_CHANNEL } : {}),
});
const report: {
  expectedSha: string;
  runId: string;
  checks: string[];
  status: string;
  organizationId?: string;
  error?: string;
  usersDisabled?: boolean;
} = {
  expectedSha,
  runId,
  checks: [],
  status: "running",
};
let userIds: string[] = [];
let productId: string | undefined;
async function login(email: string) {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 1440, height: 1000 },
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
  );
  const csrf = await (await context.request.get(`${base}/api/auth/csrf`)).json();
  await context.request.post(`${base}/api/auth/callback/credentials`, {
    form: {
      csrfToken: csrf.csrfToken,
      email,
      password,
      json: "true",
      callbackUrl: base,
    },
  });
  return context;
}
try {
  const migrations = await db.$queryRaw<
    { count: bigint }[]
  >`SELECT count(*) FROM "_prisma_migrations" WHERE migration_name = '20260910013000_baam_companion' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert.equal(Number(migrations[0].count), 1);
  report.checks.push("Exact production SHA and existing database migration verified");
  const passwordHash = await bcrypt.hash(password, 12);
  const fixture = await db.$transaction(
    async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: `INTERNAL QA UI ${expectedSha.slice(0, 8)} ${runId.slice(0, 8)}`,
          plan: "ENTERPRISE",
        },
      });
      const store = await tx.store.create({
        data: {
          organizationId: org.id,
          name: "UI release QA",
          code: "QA",
          trackExpiryLots: true,
        },
      });
      const unit = await tx.unit.create({
        data: { organizationId: org.id, code: "each", labelRu: "шт", labelKg: "даана" },
      });
      const product = await tx.product.create({
        data: {
          organizationId: org.id,
          name: "UI release smoke",
          sku: "QA-STOCK",
          unit: "each",
          baseUnitId: unit.id,
          basePriceKgs: 1,
        },
      });
      await tx.storeProduct.create({
        data: { organizationId: org.id, storeId: store.id, productId: product.id },
      });
      await tx.inventorySnapshot.create({
        data: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
          onHand: 0,
          onOrder: 0,
        },
      });
      const users = [];
      for (const role of ["ADMIN", "MANAGER", "STAFF", "CASHIER"] as const) {
        const user = await tx.user.create({
          data: {
            organizationId: org.id,
            name: `UI QA ${role}`,
            email: `ux-${role.toLowerCase()}-${runId}@example.invalid`,
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
        users.push(user);
      }
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          actorId: users[0].id,
          action: "UI_QA_FIXTURE_CREATE",
          entity: "Organization",
          entityId: org.id,
          requestId: runId,
          after: { expectedSha, isolated: true, openingStock: 0 },
        },
      });
      return { org, store, product, users };
    },
    { timeout: 30_000 },
  );
  report.organizationId = fixture.org.id;
  userIds = fixture.users.map((user) => user.id);
  productId = fixture.product.id;
  const admin = await login(fixture.users[0].email);
  await admin.addCookies([{ name: "NEXT_LOCALE", value: "ru", url: base }]);
  const page = await admin.newPage();
  page.setDefaultTimeout(45_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [path, width] of [
    ["/dashboard", 1440],
    ["/products", 1440],
    ["/inventory", 390],
    ["/pos", 390],
    ["/inventory/movements", 768],
  ] as const) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await page.goto(`${base}${path}?${path === "/pos" ? "store" : "storeId"}=${fixture.store.id}`);
    await page.locator("main").first().waitFor();
    await page.locator("[data-baam-launcher]").waitFor();
    if (path === "/dashboard") await page.locator("[data-dashboard-kpi]").first().waitFor();
    if (["/products", "/inventory"].includes(path))
      await page.locator('[data-list-toolbar]:not([aria-busy="true"])').waitFor();
    await page.screenshot({
      path: `artifacts/ux/production/${path.slice(1).replaceAll("/", "-")}-${width}.png`,
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false,
    );
    await page.locator("[data-baam-launcher]").click();
    await page.locator("[data-baam-chat]").waitFor();
    await page.keyboard.press("Escape");
  }
  report.checks.push(
    "Exact release renders dashboard, products, inventory, movements and POS at desktop/tablet/mobile widths; one working BAAM launcher",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/products?storeId=${fixture.store.id}&q=QA-STOCK`);
  await page.locator("#products-search").waitFor();
  assert.equal(await page.locator("#products-search").inputValue(), "QA-STOCK");
  await page.reload();
  await page.locator("#products-search").waitFor();
  assert.equal(await page.locator("#products-search").inputValue(), "QA-STOCK");
  await page.getByRole("link", { name: "Редактировать", exact: true }).first().click();
  await page.waitForURL(`**/products/${productId}*`);
  await page.goBack();
  await page.locator("#products-search").waitFor();
  assert.equal(await page.locator("#products-search").inputValue(), "QA-STOCK");
  report.checks.push("Search and store survive refresh, edit and browser Back on production");
  const name = `UI release form ${runId.slice(0, 8)}`;
  const returnTo = `/products?storeId=${fixture.store.id}&q=${encodeURIComponent(name)}`;
  await page.goto(
    `${base}/products/new?storeId=${fixture.store.id}&returnTo=${encodeURIComponent(returnTo)}`,
  );
  await page
    .getByRole("textbox", { name: /^Название/ })
    .first()
    .fill(name);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/products");
  await page.locator('[data-list-toolbar]:not([aria-busy="true"])').waitFor();
  assert.equal(await db.product.count({ where: { organizationId: fixture.org.id, name } }), 1);
  assert.equal(new URL(page.url()).searchParams.get("q"), name);
  report.checks.push(
    "Normal UI creates one zero-stock synthetic product and returns to its filtered list",
  );
  for (const user of fixture.users.slice(1)) {
    const context = await login(user.email);
    const tab = await context.newPage();
    await tab.goto(base + "/pos");
    await tab.locator("main").first().waitFor();
    if (user.role === "MANAGER") {
      await tab.goto(base + "/inventory");
      await tab.locator("[data-baam-launcher]").waitFor();
    } else {
      assert.equal(await tab.locator("[data-baam-launcher]").count(), 0);
      await tab.goto(base + "/inventory");
      await tab.waitForURL("**/pos*");
    }
    await context.close();
  }
  report.checks.push(
    "ADMIN/MANAGER controls remain available; STAFF/CASHIER stay within existing access rules",
  );
  assert.deepEqual(errors, []);
  await checkRelease();
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  if (userIds.length) {
    await db.user.updateMany({
      where: { id: { in: userIds }, organizationId: report.organizationId },
      data: { isActive: false, sessionVersion: { increment: 1 } },
    });
    report.usersDisabled = true;
  }
  if (report.organizationId)
    await db.auditLog.create({
      data: {
        organizationId: report.organizationId,
        actorId: userIds[0],
        action: "UI_QA_FINISH",
        entity: "Organization",
        entityId: report.organizationId,
        requestId: runId,
        after: { expectedSha, status: report.status, usersDisabled: report.usersDisabled ?? false },
      },
    });
  await db.$disconnect();
  await writeFile("artifacts/ux/production/report.json", JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  console.log(JSON.stringify(report));
}
