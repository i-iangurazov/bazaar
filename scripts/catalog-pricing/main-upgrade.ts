import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { catalogQaEnvironment } from "./environment";
import { planProductionMigrations } from "../deployment/migrations";
const root = process.cwd(),
  directory = resolve("artifacts/catalog-pricing-20261029");
const databaseName = "bazaar_hardening_agent3_transactions";
const databaseUrl = `postgresql://bazaar_test:bazaar_test_only@127.0.0.1:55448/${databaseName}`;
const env = {
  ...catalogQaEnvironment(),
  DATABASE_URL: databaseUrl,
  DATABASE_TEST_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  DATABASE_URL_UNPOOLED: databaseUrl,
  POSTGRES_URL_NON_POOLING: databaseUrl,
  RUN_DB_TESTS: "0",
  ALLOW_TEST_DB_RESET: "0",
};
async function run(args: string[]) {
  const child = spawn("pnpm", args, { cwd: root, env, stdio: "inherit" });
  if ((await new Promise((r) => child.on("exit", r))) !== 0)
    throw new Error(`Migration rehearsal command failed: ${args[1]}`);
}
const admin = new PrismaClient({
  datasourceUrl: databaseUrl.replace(`/${databaseName}`, "/postgres"),
});
const [identity] = await admin.$queryRaw<
  Array<{ directory: string }>
>`SELECT current_setting('data_directory') AS directory`;
assert(identity.directory.startsWith("/private/tmp/bazaar-catalog-20261029."));
const existing = await admin.$queryRaw<
  Array<{ datname: string }>
>`SELECT datname FROM pg_database WHERE datname=${databaseName}`;
assert(
  existing.length === 0 || process.argv.includes("--resume"),
  "Existing rehearsal requires explicit --resume, never an implicit reset",
);
if (!existing.length) await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
await admin.$disconnect();
await run([
  "exec",
  "prisma",
  "migrate",
  "deploy",
  "--schema",
  "artifacts/catalog-pricing-20261029/main-upgrade/prisma/schema.prisma",
]);
const require = createRequire(import.meta.url);
const OldClient = require("/private/tmp/bazaar-catalog-20261029.3NMPPN/main-upgrade/client")
  .PrismaClient as typeof PrismaClient;
const old = new OldClient({ datasourceUrl: databaseUrl });
async function seedLegacyFixture() {
  const org = await old.organization.create({
    data: {
      name: "Main migration preservation QA",
      plan: "BUSINESS",
      retailWholesaleEnabled: true,
      subscriptionStatus: "ACTIVE",
      currentPeriodEndsAt: new Date("2027-01-15T00:00:00Z"),
    },
  });
  const unit = await old.unit.create({
    data: {
      organizationId: org.id,
      code: "kg",
      labelRu: "кг",
      labelKg: "кг",
      quantityPrecision: 3,
    },
  });
  const user = await old.user.create({
    data: {
      organizationId: org.id,
      email: "main-upgrade@example.invalid",
      name: "Migration QA",
      role: "ADMIN",
      isOrgOwner: true,
      passwordHash: "synthetic",
      emailVerifiedAt: new Date(),
    },
  });
  const stores = await Promise.all(
    ["SOURCE", "TARGET"].map((code) =>
      old.store.create({ data: { organizationId: org.id, name: code, code } }),
    ),
  );
  const product = await old.product.create({
    data: {
      organizationId: org.id,
      name: "Legacy fractional stock",
      sku: "LEGACY-QA",
      unit: unit.code,
      baseUnitId: unit.id,
      basePriceKgs: 139.5,
    },
  });
  const variant = await old.productVariant.create({
    data: { productId: product.id, name: "Variant", attributes: {} },
  });
  for (const [i, store] of stores.entries()) {
    await old.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        isDirect: true,
        isActive: true,
      },
    });
    await old.storePrice.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        priceKgs: i ? 0 : 139.5,
      },
    });
    await old.storePriceTypes.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        retailPriceKgs: i ? 0 : 139.5,
        wholesalePriceKgs: i ? null : 120,
      },
    });
    await old.inventorySnapshot.create({
      data: {
        storeId: store.id,
        productId: product.id,
        onHand: i ? 0 : 46.85,
        onOrder: i ? 3.125 : 0,
        version: 3,
      },
    });
  }
  await old.productCost.create({
    data: { organizationId: org.id, productId: product.id, avgCostKgs: 47.8, costBasisQty: 46.85 },
  });
  await old.stockMovement.createMany({
    data: [
      {
        storeId: stores[0].id,
        productId: product.id,
        type: "RECEIVE",
        qtyDelta: 48.1,
        unitCostKgs: 47.8,
        lineTotalKgs: 2299.18,
        referenceType: "QA",
        createdById: user.id,
      },
      {
        storeId: stores[0].id,
        productId: product.id,
        type: "SALE",
        qtyDelta: -1.25,
        unitCostKgs: 47.8,
        lineTotalKgs: -59.75,
        referenceType: "QA",
        createdById: user.id,
      },
    ],
  });
  const register = await old.posRegister.create({
    data: { organizationId: org.id, storeId: stores[0].id, code: "QA", name: "QA register" },
  });
  const shift = await old.registerShift.create({
    data: {
      organizationId: org.id,
      storeId: stores[0].id,
      registerId: register.id,
      openedById: user.id,
      openingCashKgs: 0,
    },
  });
  const order = await old.customerOrder.create({
    data: {
      organizationId: org.id,
      storeId: stores[0].id,
      registerId: register.id,
      shiftId: shift.id,
      number: "LEGACY-PAID",
      status: "COMPLETED",
      isPosSale: true,
      completedAt: new Date(),
      subtotalKgs: 174.38,
      totalKgs: 174.38,
      lines: {
        create: {
          productId: product.id,
          qty: 1.25,
          unitPriceKgs: 139.5,
          lineTotalKgs: 174.38,
          unitCostKgs: 47.8,
          lineCostTotalKgs: 59.75,
        },
      },
    },
  });
  await old.salePayment.create({
    data: {
      organizationId: org.id,
      storeId: stores[0].id,
      shiftId: shift.id,
      customerOrderId: order.id,
      method: "CASH",
      amountKgs: 174.38,
      createdById: user.id,
    },
  });
  const image = await old.productImageStudioJob.create({
    data: {
      organizationId: org.id,
      productId: product.id,
      createdById: user.id,
      status: "SUCCEEDED",
      sourceImageUrl: "/qa/source.png",
      sourceImageMimeType: "image/png",
      backgroundMode: "WHITE",
      provider: "qa-no-provider",
      outputImageUrl: "/qa/result.png",
    },
  });
  return { org, image };
}
const { org, image } = existing.length
  ? {
      org: await old.organization.findFirstOrThrow({
        where: { name: "Main migration preservation QA" },
      }),
      image: await old.productImageStudioJob.findFirstOrThrow({
        where: { provider: "qa-no-provider" },
      }),
    }
  : await seedLegacyFixture();
assert.equal(await old.organization.count(), 1);
const tables = await old.$queryRaw<
  Array<{ table_name: string; columns: string[] }>
>`SELECT table_name::text, array_agg(column_name::text ORDER BY ordinal_position) AS columns FROM information_schema.columns WHERE table_schema='public' AND table_name <> '_prisma_migrations' GROUP BY table_name ORDER BY table_name`;
const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
async function snapshot(db: PrismaClient) {
  const results = [];
  for (const t of tables) {
    const rows = await db.$queryRawUnsafe<Array<{ data: string }>>(
      `SELECT to_jsonb(t)::text AS data FROM (SELECT ${t.columns.map(quote).join(",")} FROM ${quote(t.table_name)}) t ORDER BY to_jsonb(t)::text`,
    );
    results.push({
      table: t.table_name,
      rows: rows.length,
      hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    });
  }
  return results;
}
const before = await snapshot(old);
const history = await old.$queryRaw<
  Array<{
    migration_name: string;
    checksum: string;
    finished_at: Date | null;
    rolled_back_at: Date | null;
  }>
>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`;
const migrations = [];
for (const name of (await readdir(resolve("prisma/migrations"))).sort()) {
  if (!/^\d/.test(name)) continue;
  migrations.push({
    name,
    checksum: createHash("sha256")
      .update(await readFile(resolve("prisma/migrations", name, "migration.sql")))
      .digest("hex"),
  });
}
const pending = planProductionMigrations(migrations, history);
assert.equal(pending.length, 5);
await old.$disconnect();
await run(["prisma:migrate"]);
const current = new PrismaClient({ datasourceUrl: databaseUrl });
const after = await snapshot(current);
assert.deepEqual(after, before);
const currentOrg = await current.organization.findUniqueOrThrow({ where: { id: org.id } });
assert.equal(currentOrg.subscriptionBillingMode, "MANUAL");
assert.equal(currentOrg.plan, "BUSINESS");
assert.equal(currentOrg.subscriptionStatus, "ACTIVE");
assert.equal(
  (await current.productImageStudioJob.findUniqueOrThrow({ where: { id: image.id } })).highQuality,
  true,
);
assert.equal(await current.priceBookStore.count(), 0);
assert.equal(await current.priceBookEntry.count(), 0);
assert.equal(await current.subscriptionInvoice.count(), 0);
const newHistory = await current.$queryRaw<
  typeof history
>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`;
assert.deepEqual(planProductionMigrations(migrations, newHistory), []);
await run(["prisma:migrate"]);
const result = {
  main: "5a27b8e37f03df2d73603fe37e4975d44888ddf5",
  database: databaseName,
  pendingBefore: pending,
  pendingAfter: [],
  legacyTables: before.length,
  legacyRows: before.reduce((n, t) => n + t.rows, 0),
  unchanged: true,
  tables: after,
  zeroPricePreserved: true,
  fractionalStockPreserved: true,
  paidOrderAndPaymentPreserved: true,
  existingAccessRemainsManual: true,
  existingStudioQualityPreserved: true,
  automaticStoreConnections: 0,
  actualProviderCalls: 0,
};
await writeFile(
  resolve(directory, "main-upgrade-verification.json"),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ ...result, tables: undefined }, null, 2));
await current.$disconnect();
