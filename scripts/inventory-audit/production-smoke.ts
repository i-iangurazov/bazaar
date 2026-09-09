/** Authenticated production smoke. Writes ONLY to a newly created isolated QA
 * organization; never creates a sale, payment, fiscal receipt or customer. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import bcrypt from "bcryptjs";
import { PrismaClient, type InventorySnapshot } from "@prisma/client";
import { chromium, type BrowserContext } from "playwright";

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
// Use the existing configured connection in memory; do not download/copy secrets.
const config = parseEnv(await readFile(".vercel/.env.production.local", "utf8"));
if (!config.DATABASE_URL) throw new Error("No existing production database connection");
const db = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
const runId = randomUUID();
const password = randomBytes(32).toString("base64url");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.QA_BROWSER_CHANNEL ? { channel: process.env.QA_BROWSER_CHANNEL } : {}),
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
async function api<T>(
  context: BrowserContext,
  route: string,
  input: unknown,
  mutation = false,
): Promise<T> {
  const response = mutation
    ? await context.request.post(`${base}/api/trpc/${route}`, { data: { json: input } })
    : await context.request.get(
        `${base}/api/trpc/${route}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
      );
  const body = await response.json();
  if (body.error)
    throw new Error(body.error.json?.message ?? "Production API rejected smoke operation");
  return body.result.data.json;
}
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
  const migrated = await db.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='inventory_snapshot_stock_version' AND NOT tgisinternal) AS present
  `;
  assert.equal(migrated[0]?.present, true, "Production stock version migration must be installed");
  report.checks.push("Exact production SHA and inventory version trigger verified");
  const passwordHash = await bcrypt.hash(password, 12);
  const fixture = await db.$transaction(
    async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: `INTERNAL QA inventory ${expectedSha.slice(0, 8)} ${runId.slice(0, 8)}`,
          plan: "ENTERPRISE",
        },
      });
      const store = await tx.store.create({
        data: {
          organizationId: org.id,
          name: "Inventory release QA",
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
          name: "Inventory release smoke",
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
      for (const role of ["ADMIN", "MANAGER"] as const) {
        const user = await tx.user.create({
          data: {
            organizationId: org.id,
            name: `Inventory QA ${role}`,
            email: `inventory-${role.toLowerCase()}-${runId}@example.invalid`,
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
          action: "INVENTORY_QA_FIXTURE_CREATE",
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
  const manager = await login(fixture.users[1].email);
  const page = await admin.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/products`);
  const store = page
    .locator('[role="combobox"]:visible')
    .filter({ hasText: "Inventory release QA" })
    .first();
  await store.waitFor({ timeout: 60_000 });
  const row = page.locator("tr").filter({ hasText: "Inventory release smoke" });
  const cell = row.locator('[data-inline-cell$=":onHand"]');
  const editor = () => row.getByRole("textbox", { name: /Редактирование поля: В наличии/ });
  await cell.waitFor({ timeout: 60_000 });
  await cell.dblclick();
  await editor().fill("2");
  await editor().press("Enter");
  await editor().waitFor({ state: "hidden" });
  const stock = async () => {
    const response = await api<{ items: { snapshot: InventorySnapshot }[] }>(
      admin,
      "inventory.list",
      { storeId: fixture.store.id },
    );
    return response.items.find((item) => item.snapshot.productId === fixture.product.id)!.snapshot;
  };
  assert.equal((await stock()).onHand, 2);
  report.checks.push("Authenticated production double-click commits an adjustment");
  await cell.dblclick();
  await editor().fill("4");
  const before = await stock();
  await api(
    manager,
    "inventory.setOnHand",
    {
      storeId: fixture.store.id,
      productId: fixture.product.id,
      expectedOnHand: 2,
      expectedVersion: before.version,
      targetOnHand: 3,
      reason: "Isolated release concurrency smoke",
      idempotencyKey: randomUUID(),
    },
    true,
  );
  await editor().press("Enter");
  await editor().waitFor({ state: "hidden" });
  await page.getByRole("alert").filter({ hasText: "Остаток уже изменён" }).waitFor();
  assert.equal((await stock()).onHand, 3);
  report.checks.push(
    "Second authenticated production session causes an explicit conflict, without lost stock",
  );
  await cell.dblclick();
  await editor().fill("0");
  await editor().press("Enter");
  await editor().waitFor({ state: "hidden" });
  await page.reload();
  await cell.waitFor();
  assert.equal((await stock()).onHand, 0);
  const [snapshot, movement, lots, counts] = await Promise.all([
    db.inventorySnapshot.findFirstOrThrow({ where: { productId } }),
    db.stockMovement.aggregate({ where: { productId }, _sum: { qtyDelta: true }, _count: true }),
    db.stockLot.aggregate({ where: { productId }, _sum: { onHandQty: true } }),
    db.$queryRaw<{ sales: number; payments: number; fiscal: number }[]>`
      SELECT (SELECT COUNT(*)::int FROM "CustomerOrder" WHERE "organizationId"=${fixture.org.id}) AS sales,
        (SELECT COUNT(*)::int FROM "SalePayment" WHERE "organizationId"=${fixture.org.id}) AS payments,
        (SELECT COUNT(*)::int FROM "FiscalReceipt" WHERE "organizationId"=${fixture.org.id}) AS fiscal
    `,
  ]);
  assert.equal(snapshot.onHand, 0);
  assert.equal(snapshot.version, 3);
  assert.equal(movement._sum.qtyDelta, 0);
  assert.equal(movement._count, 3);
  assert.equal(lots._sum.onHandQty, 0);
  assert.deepEqual(counts, [{ sales: 0, payments: 0, fiscal: 0 }]);
  assert.deepEqual(errors, []);
  await checkRelease();
  await mkdir("artifacts/bazaar-stock-audit", { recursive: true });
  await page.screenshot({
    path: "artifacts/bazaar-stock-audit/production-smoke.png",
    fullPage: true,
  });
  report.checks.push(
    "Reload, journal, lots and revision agree; no sales/payments/fiscal operations; SHA remains exact",
  );
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
  if (report.status === "passed" && productId) {
    await db.product.update({ where: { id: productId }, data: { isDeleted: true } });
  }
  await db.$disconnect();
  await mkdir("artifacts/bazaar-stock-audit", { recursive: true });
  await writeFile(
    "artifacts/bazaar-stock-audit/production-authenticated-smoke.json",
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
}
