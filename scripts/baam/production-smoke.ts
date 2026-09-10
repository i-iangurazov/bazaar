/** Exact-SHA BAAM smoke. Only synthetic organization and products; no sales, payments or mail. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import bcrypt from "bcryptjs";
import { PrismaClient, type BaamConversation } from "@prisma/client";
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
await mkdir("artifacts/baam-companion", { recursive: true });
// Use the existing configured connection in memory; do not download/copy secrets.
const config = parseEnv(await readFile(".vercel/.env.production.local", "utf8"));
if (!config.DATABASE_URL) throw new Error("No existing production database connection");
const db = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
const runId = randomUUID();
const password = randomBytes(32).toString("base64url");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BAAM_BROWSER_CHANNEL ? { channel: process.env.BAAM_BROWSER_CHANNEL } : {}),
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
  const migrations = await db.$queryRaw<
    { count: bigint }[]
  >`SELECT count(*) FROM "_prisma_migrations" WHERE migration_name = '20260910013000_baam_companion' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert.equal(Number(migrations[0].count), 1);
  report.checks.push("Exact production SHA and additive BAAM migration verified");
  const passwordHash = await bcrypt.hash(password, 12);
  const fixture = await db.$transaction(
    async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: `INTERNAL QA BAAM ${expectedSha.slice(0, 8)} ${runId.slice(0, 8)}`,
          plan: "ENTERPRISE",
        },
      });
      const store = await tx.store.create({
        data: {
          organizationId: org.id,
          name: "BAAM release QA",
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
          name: "BAAM release smoke",
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
            name: `BAAM QA ${role}`,
            email: `baam-${role.toLowerCase()}-${runId}@example.invalid`,
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
          action: "BAAM_QA_FIXTURE_CREATE",
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
  await admin.addCookies([{ name: "NEXT_LOCALE", value: "en", url: base }]);
  const page = await admin.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const path of ["/pos", "/inventory", "/products"]) {
    await page.goto(base + path);
    await page.locator("[data-baam-launcher]").waitFor();
    assert.equal(await page.locator("[data-baam-launcher]").count(), 1);
    await page.locator("[data-baam-launcher]").click();
    await page.locator("[data-baam-chat]").waitFor();
    await page.keyboard.press("Escape");
  }
  report.checks.push("One launcher on POS, Inventory and Products; first click works");
  await page.locator("[data-baam-launcher]").click();
  const chat = page.locator("[data-baam-chat]");
  await chat.waitFor();
  await chat.getByRole("button", { name: "New conversation", exact: true }).click();
  const name = `BAAM release test ${runId.slice(0, 8)}`;
  await chat
    .locator("[data-baam-input]")
    .fill(
      `Create product "${name}" in BAAM release QA, unit each, selling price zero KGS, opening stock zero, cost zero, without a photo.`,
    );
  await chat.getByRole("button", { name: "Send message", exact: true }).click();
  await chat.getByRole("button", { name: "Execute", exact: true }).waitFor({ timeout: 150000 });
  await chat.getByRole("button", { name: "Execute", exact: true }).click();
  await chat.getByText("Completed", { exact: true }).waitFor({ timeout: 30000 });
  const product = await db.product.findFirstOrThrow({
    where: { name, organizationId: fixture.org.id },
  });
  assert.equal(await db.product.count({ where: { name, organizationId: fixture.org.id } }), 1);
  assert.equal(
    await db.storeProduct.count({ where: { productId: product.id, storeId: fixture.store.id } }),
    1,
  );
  report.checks.push("Actual production provider created a normal product once through BAAM");
  await page.screenshot({ path: "artifacts/baam-companion/production-desktop.png" });
  await page.reload();
  await page.locator("[data-baam-launcher]").click();
  await chat.getByText(name, { exact: true }).waitFor();
  const dialogs = await api<{ items: BaamConversation[] }>(admin, "baam.conversations", {});
  assert.ok(dialogs.items.length);
  const conversation = dialogs.items[0];
  await api(
    admin,
    "baam.changeConversation",
    {
      id: conversation.id,
      revision: conversation.revision,
      title: "Production history verification",
    },
    true,
  );
  await page.reload();
  await page.locator("[data-baam-launcher]").click();
  await chat.getByRole("button", { name: "Conversations", exact: true }).click();
  await page.getByText("Production history verification", { exact: true }).waitFor();
  report.checks.push("History, result, rename and refresh persist on production");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/inventory");
  await page.locator("[data-baam-launcher]").click();
  await chat.waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: "artifacts/baam-companion/production-mobile.png" });
  await page.keyboard.press("Escape");
  const manager = await login(fixture.users[1].email);
  for (const path of ["/pos", "/inventory"]) {
    const tab = await manager.newPage();
    await tab.goto(base + path);
    await tab.locator("[data-baam-launcher]").click();
    await tab.locator("[data-baam-chat]").waitFor();
    await tab.close();
  }
  await assert.rejects(api(manager, "baam.conversation", { id: conversation.id }));
  const own = await api<BaamConversation>(
    manager,
    "baam.createConversation",
    { locale: "en", storeId: fixture.store.id },
    true,
  );
  await api(
    manager,
    "baam.changeConversation",
    { id: own.id, revision: own.revision, remove: true },
    true,
  );
  await assert.rejects(api(manager, "baam.conversation", { id: own.id }));
  report.checks.push("MANAGER POS/Inventory; foreign history denied; conversation deletion works");
  assert.deepEqual(errors, []);
  await db.product.update({ where: { id: product.id }, data: { isDeleted: true } });
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
  if (report.status === "passed" && productId) {
    await db.product.update({ where: { id: productId }, data: { isDeleted: true } });
  }
  await db.$disconnect();
  await mkdir("artifacts/baam-companion", { recursive: true });
  await writeFile(
    "artifacts/baam-companion/production-authenticated-smoke.json",
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
}
