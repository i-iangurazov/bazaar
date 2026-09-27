import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { reportingEnvironment, assertReportingDatabase } from "./environment";
import {
  planAssortmentRecovery,
  applyAssortmentRecovery,
  recoveryBusinessDigest,
} from "../../src/server/services/assortmentRecovery";

Object.assign(process.env, reportingEnvironment());
assertReportingDatabase();
const { prisma } = await import("../../src/server/db/prisma");
const stamp = Date.now(),
  email = `recovery-${stamp}@example.invalid`,
  password = "RecoveryFixture123!";
const org = await prisma.organization.create({
  data: { name: `Recovery fixture ${stamp}`, plan: "ENTERPRISE" },
});
const adminUser = await prisma.user.create({
  data: {
    organizationId: org.id,
    email,
    name: "Recovery test admin",
    role: "ADMIN",
    isOrgOwner: true,
    passwordHash: await bcrypt.hash(password, 10),
    emailVerifiedAt: new Date(),
  },
});
const baseUnit = await prisma.unit.create({
  data: { organizationId: org.id, code: "each", labelRu: "шт", labelKg: "даана" },
});
const store = await prisma.store.create({
  data: { organizationId: org.id, name: "Учебный Гранд", code: `G${stamp}` },
});
const product = await prisma.product.create({
  data: {
    organizationId: org.id,
    name: "Исходный учебный товар",
    sku: "BASE",
    unit: "each",
    baseUnitId: baseUnit.id,
  },
});
const f = { org, adminUser, baseUnit, store, product };
const names = [
  "Учебный Баткен",
  "Учебный Дордой",
  "Учебный Мега",
  "Учебный Орто",
  "Учебный 6",
  "Учебный 7",
  "Учебный 8",
  "Учебный 9",
  "Учебный 10",
];
const stores = [
  { ...f.store, name: "Учебный Гранд" },
  ...(await Promise.all(
    names.map((name, i) =>
      prisma.store.create({ data: { organizationId: f.org.id, name, code: `R${stamp}-${i}` } }),
    ),
  )),
];
const ids = [f.product.id, ...Array.from({ length: 3363 }, () => randomUUID())];
await prisma.product.createMany({
  data: ids.slice(1).map((id, i) => ({
    id,
    organizationId: f.org.id,
    name: `Учебный товар ${i + 2}`,
    sku: `R-${i + 2}`,
    unit: "each",
    baseUnitId: f.baseUnit.id,
  })),
});
const counts = [982, 2382, 2382, 2382, 2382, 3, 24, 33, 3, 101];
const sets = stores.map((s, i) =>
  i === 0 ? ids.slice(0, 982) : i < 5 ? ids.slice(982) : ids.slice(0, counts[i]),
);
const old = new Date(Date.now() - 60_000);
await prisma.storeProduct.updateMany({
  where: { organizationId: f.org.id },
  data: { createdAt: old, updatedAt: old },
});
const originals = stores.flatMap((s, i) =>
  sets[i].map((productId) => ({
    organizationId: f.org.id,
    storeId: s.id,
    productId,
    createdAt: old,
    updatedAt: old,
  })),
);
await prisma.storeProduct.createMany({ data: originals, skipDuplicates: true });
await prisma.inventorySnapshot.createMany({
  data: originals.map((a) => ({ storeId: a.storeId, productId: a.productId, onHand: 0 })),
  skipDuplicates: true,
});
await prisma.inventorySnapshot.updateMany({
  where: { storeId: f.store.id, productId: f.product.id },
  data: { onHand: 10 },
});
const boundary = new Date();
const added = stores.slice(0, 5).flatMap((s, i) =>
  ids
    .filter((id) => !sets[i].includes(id))
    .map((productId) => ({
      organizationId: f.org.id,
      storeId: s.id,
      productId,
      assignedById: f.adminUser.id,
      createdAt: boundary,
      updatedAt: boundary,
    })),
);
await prisma.storeProduct.createMany({ data: added });
await prisma.inventorySnapshot.createMany({
  data: added.map((a) => ({ storeId: a.storeId, productId: a.productId, onHand: 0 })),
});
const catalog = await prisma.productCatalog.create({
  data: { organizationId: f.org.id, name: "Учебный Гранд" },
});
await prisma.store.updateMany({
  where: { id: { in: stores.slice(0, 5).map((s) => s.id) } },
  data: { productCatalogId: catalog.id },
});
const audit = await prisma.auditLog.create({
  data: {
    organizationId: f.org.id,
    actorId: f.adminUser.id,
    action: "STORE_ASSORTMENT_SHARE",
    entity: "ProductCatalog",
    entityId: catalog.id,
    requestId: randomUUID(),
    before: {
      sourceStore: {
        id: stores[1].id,
        currentCatalogId: catalog.id,
        currentCatalogName: "Учебный общий набор",
      },
      groupStoreImpacts: stores
        .slice(0, 5)
        .map((s, i) => ({ storeId: s.id, productsToAdd: 3364 - counts[i] })),
      totalProductsToAssign: 6310,
      totalSharedProductCount: 3364,
      sourceProductCount: 2382,
    },
  },
});
const plan = await prisma.$transaction((tx) => planAssortmentRecovery(tx, f.org.id, audit.id), {
  timeout: 60_000,
});
const before = await prisma.$transaction((tx) => recoveryBusinessDigest(tx, f.org.id), {
  timeout: 60_000,
});
const out = "artifacts/directional/after/recovery",
  base = "https://localhost:3123";
await mkdir(out, { recursive: true });
const m = JSON.parse(await readFile("messages/ru.json", "utf8"));
const browser = await chromium.launch();
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 1000 },
  serviceWorkers: "block",
  reducedMotion: "reduce",
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const errors: string[] = [],
  checks: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const until = async (fn: () => Promise<boolean>) => {
  const deadline = Date.now() + 30_000;
  while (!(await fn())) {
    if (Date.now() > deadline) throw Error("Timed out waiting for recovered assortment");
    await page.waitForTimeout(100);
  }
};
async function api(method: string, input: unknown) {
  const r = await context.request.get(
    `${base}/api/trpc/${method}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
  );
  const body = await r.json();
  assert.ok(!body.error, JSON.stringify(body.error));
  return body.result.data.json;
}
try {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ru", url: base }]);
  const csrf = await (await context.request.get(base + "/api/auth/csrf")).json();
  await context.request.post(base + "/api/auth/callback/credentials", {
    form: { csrfToken: csrf.csrfToken, email, password, json: "true", callbackUrl: base },
  });
  assert.equal(
    (await (await context.request.get(base + "/api/auth/session")).json()).user.organizationId,
    f.org.id,
  );
  await page.goto(base + `/settings/store-groups?storeId=${f.store.id}`);
  await until(
    async () =>
      (await page.getByTestId("assortment-total").innerText()).replace(/\D/g, "") === "3364",
  );
  await page.screenshot({ path: out + "/before-recovery.png", fullPage: true });
  await prisma.$transaction((tx) => applyAssortmentRecovery(tx, plan), {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: 120_000,
  });
  assert.deepEqual(
    await prisma.$transaction((tx) => recoveryBusinessDigest(tx, f.org.id), { timeout: 60_000 }),
    before,
  );
  await page.reload();
  await until(async () => (await page.getByTestId("assortment-total").innerText()) === "982");
  const settings = await api("stores.catalogSettings", { storeId: f.store.id });
  assert.equal(
    settings.sources.find((s: { key: string }) => s.key === `store:${stores[1].id}`).total,
    2382,
  );
  for (let i = 0; i < 10; i++)
    assert.equal(
      settings.stores.find((s: { id: string }) => s.id === stores[i].id).baseCount,
      counts[i],
    );
  assert.equal(await page.getByRole("switch").count(), 9);
  assert.equal(
    await page.getByRole("button", { name: m.catalogSources.addSource, exact: true }).count(),
    0,
  );
  const nav = page.getByRole("navigation", { name: m.catalogSources.store, exact: true });
  assert.equal(await nav.getByRole("button").count(), 10);
  await page.screenshot({ path: out + "/desktop.png", fullPage: true });
  checks.push(
    "Exact 982/2382 baseline identities; ten stores, nine switches, no empty catalogue choices; unchanged business-record hashes",
  );
  const toggle = page.getByRole("switch", {
    name: m.catalogSources.accessLabel.replace("{name}", stores[1].name),
    exact: true,
  });
  const save = page.getByRole("button", { name: m.catalogSources.save, exact: true });
  await toggle.focus();
  await toggle.press("Space");
  await until(() => save.isEnabled());
  await page.screenshot({ path: out + "/preview.png", fullPage: true });
  await save.click();
  await page.getByText(m.catalogSources.saved, { exact: true }).waitFor();
  await page.reload();
  await until(
    async () =>
      (await page.getByTestId("assortment-total").innerText()).replace(/\D/g, "") === "3364",
  );
  const scanner = await api("products.searchQuick", { storeId: f.store.id, q: "R-983" });
  assert.ok(scanner.some((p: { id: string }) => p.id === ids[982]));
  await toggle.click();
  await until(() => save.isEnabled());
  await save.click();
  await page.getByText(m.catalogSources.saved, { exact: true }).waitFor();
  await page.reload();
  await until(async () => (await page.getByTestId("assortment-total").innerText()) === "982");
  assert.deepEqual(await api("products.searchQuick", { storeId: f.store.id, q: "R-983" }), []);
  const snapshot = await prisma.inventorySnapshot.findFirstOrThrow({
    where: { storeId: f.store.id, productId: f.product.id },
  });
  assert.equal(snapshot.onHand, 10);
  assert.equal(
    await prisma.storeProduct.count({ where: { organizationId: f.org.id } }),
    originals.length + added.length,
  );
  checks.push(
    "Keyboard enable/save/reload 982 → 3364; disable/save/reload → 982; scanner access agrees; original stock retained",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: out + "/mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }));
} finally {
  await writeFile(out + "/checks.json", JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
  await prisma.$disconnect();
}
