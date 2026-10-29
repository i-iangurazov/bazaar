import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, open, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { request as secureRequest } from "node:https";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { chromium } from "playwright";
import superjson from "superjson";
import { catalogQaEnvironment } from "../catalog-pricing/environment";
import { binaries as localBinaries } from "../local/services";

// Fixed disposable cluster. There is intentionally no customer URL override.
const root = process.cwd();
const { values } = parseArgs({ options: { package: { type: "string" } } });
assert(values.package, "Pass --package <prepared rollback directory>");
const directory = resolve(values.package),
  candidate = resolve(directory, "candidate");
assert(directory.startsWith(resolve(root, "artifacts") + "/"));
const manifest = JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8"));
const stamp = Date.now().toString(),
  databaseName = `bazaar_hardening_rollback_${stamp}`;
const url = `postgresql://bazaar_test:bazaar_test_only@127.0.0.1:55448/${databaseName}`;
const authSecret = "rollback-disposable-authentication-secret-only";
const healthSecret = "rollback-disposable-health-secret-only";
const env: NodeJS.ProcessEnv = {
  ...catalogQaEnvironment(),
  DATABASE_URL: url,
  DATABASE_TEST_URL: url,
  DIRECT_URL: url,
  DATABASE_URL_UNPOOLED: url,
  POSTGRES_URL_NON_POOLING: url,
  EXPECTED_TEST_DB_NAME: databaseName,
  REDIS_URL: "redis://127.0.0.1:56398/13",
  REDIS_KEY_PREFIX: `rollback-${stamp}`,
  NEXTAUTH_SECRET: authSecret,
  NEXTAUTH_URL: "https://localhost:3124",
  HEALTHCHECK_SECRET: healthSecret,
  NODE_ENV: "production",
  RUN_DB_TESTS: "0",
  ALLOW_TEST_DB_RESET: "0",
  VERCEL: undefined,
};
const checks: string[] = [],
  children: ChildProcess[] = [];
const record = (message: string) => {
  checks.push(message);
  console.log(`PASS ${message}`);
};
const require = createRequire(import.meta.url);
const oldRequire = createRequire(resolve(candidate, "package.json"));
const OldClient = oldRequire("@prisma/client").PrismaClient as typeof PrismaClient;
const old = new OldClient({ datasourceUrl: url }),
  db = new PrismaClient({ datasourceUrl: url });
const admin = new PrismaClient({ datasourceUrl: url.replace(`/${databaseName}`, "/postgres") });
const log = await open(resolve(directory, `rehearsal-${stamp}.log`), "a", 0o600);
async function run(
  command: string,
  args: string[],
  cwd = root,
  extra: Partial<NodeJS.ProcessEnv> = {},
) {
  console.log(`RUN ${command} ${args.join(" ")}`);
  const child = spawn(command, args, {
    cwd,
    env: { ...env, ...extra },
    stdio: ["ignore", log.fd, log.fd],
  });
  const status = await new Promise<number | null>((done, reject) => {
    child.once("error", reject);
    child.once("exit", done);
  });
  assert.equal(
    status,
    0,
    `Failed: ${command} ${args.join(" ")}; inspect ${directory}/rehearsal-${stamp}.log`,
  );
}
async function start(cwd: string, port: number) {
  const runner = resolve(directory, "runtime-server.mjs");
  await writeFile(
    runner,
    `import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';import {createServer} from 'node:https';
const require=createRequire(process.cwd()+'/package.json');const next=require('next');const port=Number(process.env.PORT);
const app=next({dev:false,hostname:'localhost',port});await app.prepare();
const server=createServer({key:readFileSync(process.env.ROLLBACK_TLS_KEY),cert:readFileSync(process.env.ROLLBACK_TLS_CERT)},app.getRequestHandler());
server.listen(port,'127.0.0.1');process.on('SIGTERM',()=>{server.close();void app.close().finally(()=>process.exit(0))});\n`,
  );
  const child = spawn(process.execPath, [runner], {
    cwd,
    env: {
      ...env,
      NEXTAUTH_URL: `https://localhost:${port}`,
      PORT: String(port),
      ROLLBACK_TLS_KEY: resolve(directory, `tls-${stamp}.key`),
      ROLLBACK_TLS_CERT: resolve(directory, `tls-${stamp}.crt`),
    },
    stdio: ["ignore", log.fd, log.fd],
  });
  children.push(child);
  for (let attempt = 0; attempt < 120; attempt++) {
    assert(child.exitCode === null && child.signalCode === null, `QA server ${port} exited`);
    const health = await localRequest(port, "/api/health", "GET", {
      "x-health-secret": healthSecret,
    })
      .then((r) => r.body)
      .catch(() => null);
    if (
      health?.status === "ok" &&
      health.db === "up" &&
      health.redis === "up" &&
      health.migrations === "ok"
    )
      return;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`QA server ${port} did not become ready`);
}
async function snapshot(client: PrismaClient) {
  const tables = await client.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename::text FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const result = [];
  for (const { tablename } of tables) {
    assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(tablename));
    const [row] = await client.$queryRawUnsafe<Array<{ count: number; hash: string }>>(
      `SELECT count(*)::int AS count, md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) AS hash FROM public."${tablename}" t`,
    );
    result.push({ table: tablename, ...row! });
  }
  return result;
}
let cookie = "";
function localRequest(
  port: number,
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; body: any }> {
  assert([3124, 3127].includes(port));
  return new Promise((done, reject) => {
    // TLS exception is confined to these two synthetic localhost servers.
    const request = secureRequest(
      {
        hostname: "localhost",
        port,
        path,
        method,
        headers,
        rejectUnauthorized: false,
        timeout: 30_000,
      },
      (response) => {
        let value = "";
        response.on("data", (chunk) => {
          value += chunk;
        });
        response.on("end", () => {
          try {
            done({ status: response.statusCode!, body: JSON.parse(value) });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    request.once("error", reject);
    request.once("timeout", () => request.destroy(new Error("Local QA request timed out")));
    request.end(body);
  });
}
async function api(
  port: number,
  procedure: string,
  input: unknown,
  mutation = false,
  customCookie = cookie,
) {
  const query = encodeURIComponent(JSON.stringify(superjson.serialize(input)));
  const response = await localRequest(
    port,
    `/api/trpc/${procedure}${mutation ? "" : `?input=${query}`}`,
    mutation ? "POST" : "GET",
    { Cookie: customCookie, "content-type": "application/json" },
    mutation ? JSON.stringify(superjson.serialize(input)) : undefined,
  );
  const result = response.body;
  if (result.error)
    throw Object.assign(new Error(`${procedure}: ${JSON.stringify(result.error)}`), {
      status: response.status,
    });
  assert.equal(response.status, 200);
  return superjson.deserialize<any>(result.result.data);
}
async function sale(port: number, registerId: string, productId: string, qty: number) {
  const draft = await api(
    port,
    "pos.sales.createDraft",
    { registerId, lines: [{ productId, qty }] },
    true,
  );
  const receipt = await api(port, "pos.sales.get", { saleId: draft.id });
  const request = {
    saleId: draft.id,
    idempotencyKey: randomUUID(),
    payments: [{ method: "CASH", amountKgs: Number(receipt.totalKgs) }],
  };
  await api(port, "pos.sales.complete", request, true);
  return { request, receipt: await api(port, "pos.sales.get", { saleId: draft.id }) };
}
try {
  const [identity] = await admin.$queryRaw<
    Array<{ directory: string }>
  >`SELECT current_setting('data_directory') AS directory`;
  assert(identity.directory.startsWith("/private/tmp/bazaar-catalog-20261029."));
  await run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-keyout",
    resolve(directory, `tls-${stamp}.key`),
    "-out",
    resolve(directory, `tls-${stamp}.crt`),
    "-subj",
    "/CN=localhost",
  ]);
  await chmod(resolve(directory, `tls-${stamp}.key`), 0o600);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  await mkdir(resolve(directory, "baseline"), { recursive: true });
  execFileSync(
    "git",
    [
      "archive",
      "--format=tar",
      "--output",
      resolve(directory, "baseline.tar"),
      manifest.base,
      "prisma",
    ],
    { cwd: root },
  );
  execFileSync("tar", [
    "-xf",
    resolve(directory, "baseline.tar"),
    "-C",
    resolve(directory, "baseline"),
  ]);
  await run("pnpm", [
    "exec",
    "prisma",
    "migrate",
    "deploy",
    "--schema",
    resolve(directory, "baseline/prisma/schema.prisma"),
  ]);
  const org = await old.organization.create({
    data: {
      name: "Rollback synthetic fixture",
      plan: "ENTERPRISE",
      retailWholesaleEnabled: true,
      subscriptionStatus: "ACTIVE",
      currentPeriodEndsAt: new Date("2030-01-01"),
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
      email: "rollback@example.invalid",
      name: "Rollback QA",
      passwordHash: "synthetic-unused",
      role: "ADMIN",
      isOrgOwner: true,
      emailVerifiedAt: new Date(),
    },
  });
  const staff = await old.user.create({
    data: {
      organizationId: org.id,
      email: "staff-rollback@example.invalid",
      name: "Restricted QA",
      passwordHash: "synthetic-unused",
      role: "STAFF",
      emailVerifiedAt: new Date(),
    },
  });
  const stores = await Promise.all(
    ["Warehouse", "Shop"].map((name, i) =>
      old.store.create({ data: { organizationId: org.id, name, code: `R${i}` } }),
    ),
  );
  await old.userStoreAccess.create({
    data: { organizationId: org.id, userId: staff.id, storeId: stores[1].id },
  });
  const product = await old.product.create({
    data: {
      organizationId: org.id,
      name: "Rollback fractional product",
      sku: "ROLLBACK-QA",
      unit: unit.code,
      baseUnitId: unit.id,
      basePriceKgs: 325,
    },
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
        priceKgs: i ? 0 : 325,
      },
    });
    await old.storePriceTypes.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        retailPriceKgs: i ? 0 : 325,
        wholesalePriceKgs: 300,
      },
    });
    await old.inventorySnapshot.create({
      data: { storeId: store.id, productId: product.id, onHand: i ? 0 : 100.125 },
    });
  }
  await old.productCost.create({
    data: { organizationId: org.id, productId: product.id, avgCostKgs: 100, costBasisQty: 100.125 },
  });
  await old.stockMovement.create({
    data: {
      storeId: stores[0].id,
      productId: product.id,
      type: "RECEIVE",
      qtyDelta: 100.125,
      unitCostKgs: 100,
      lineTotalKgs: 10012.5,
      referenceType: "ROLLBACK_QA",
      createdById: user.id,
    },
  });
  const register = await old.posRegister.create({
    data: {
      organizationId: org.id,
      storeId: stores[0].id,
      code: "ROLLBACK",
      name: "Rollback register",
    },
  });
  const beforeUpgrade = await snapshot(old);
  await old.$disconnect();
  await run("pnpm", ["prisma:migrate"]);
  const upgraded = await snapshot(db);
  for (const t of beforeUpgrade.filter(
    (t) => !["Organization", "_prisma_migrations"].includes(t.table),
  ))
    assert.deepEqual(
      upgraded.find((x) => x.table === t.table),
      t,
    );
  record("Legacy rows, zero prices and fractional stock survive the five additive migrations");
  const token = await encode({
    secret: authSecret,
    token: {
      sub: user.id,
      organizationId: org.id,
      role: user.role,
      email: user.email,
      name: user.name,
      isOrgOwner: true,
      sessionVersion: user.sessionVersion,
    },
  });
  cookie = `__Secure-next-auth.session-token=${token}; next-auth.session-token=${token}; NEXT_LOCALE=ru`;
  const staffToken = await encode({
    secret: authSecret,
    token: {
      sub: staff.id,
      organizationId: org.id,
      role: staff.role,
      email: staff.email,
      name: staff.name,
      sessionVersion: staff.sessionVersion,
    },
  });
  const staffCookie = `__Secure-next-auth.session-token=${staffToken}; next-auth.session-token=${staffToken}; NEXT_LOCALE=ru`;
  await start(resolve(root, "artifacts/catalog-pricing-20261029/app"), 3124);
  const book = await api(3124, "priceBooks.create", { name: "Post-release shared prices" }, true);
  for (const change of [
    {
      kind: "PRICES",
      entries: [{ productId: product.id, retailPriceKgs: 350, wholesalePriceKgs: 300 }],
    },
    { kind: "CONNECT", storeIds: stores.map((s) => s.id), preserveLocal: true },
    {
      kind: "SOURCE",
      storeIds: [stores[0].id],
      productId: product.id,
      retailShared: true,
      wholesaleShared: true,
    },
  ]) {
    const preview = await api(3124, "priceBooks.preview", { bookId: book.id, change }, true);
    await api(
      3124,
      "priceBooks.publish",
      { bookId: book.id, change, token: preview.token, idempotencyKey: randomUUID() },
      true,
    );
  }
  await api(
    3124,
    "pos.shifts.open",
    { registerId: register.id, openingCashKgs: 0, idempotencyKey: randomUUID() },
    true,
  );
  const newSale = await sale(3124, register.id, product.id, 1.25);
  assert.equal(Number(newSale.receipt.totalKgs), 437.5);
  const transferRequest = {
    fromStoreId: stores[0].id,
    toStoreId: stores[1].id,
    lines: [{ productId: product.id, qty: 2.375 }],
    idempotencyKey: randomUUID(),
  };
  await api(3124, "inventory.transfer", transferRequest, true);
  await assert.rejects(api(3124, "inventory.list", { storeId: stores[0].id }, false, staffCookie));
  const imageJob = await db.productImageStudioJob.create({
    data: {
      organizationId: org.id,
      productId: product.id,
      createdById: user.id,
      status: "SUCCEEDED",
      sourceImageUrl: "/synthetic/source.png",
      sourceImageMimeType: "image/png",
      backgroundMode: "WHITE",
      provider: "synthetic-no-provider",
      outputImageUrl: "/synthetic/result.png",
      highQuality: false,
    },
  });
  const invoice = await db.subscriptionInvoice.create({
    data: {
      organizationId: org.id,
      createdById: user.id,
      idempotencyKey: randomUUID(),
      plan: "ENTERPRISE",
      amountMinor: 100,
      currency: "KGS",
      status: "PAID",
      merchantId: "synthetic-no-merchant",
      isTest: true,
      termsVersion: "synthetic",
      termsUrl: "https://example.invalid/terms",
      sellerName: "Synthetic fixture only",
      expiresAt: new Date("2030-01-01"),
      paidAt: new Date(),
    },
  });
  await db.subscriptionPaymentEvent.create({
    data: {
      invoiceId: invoice.id,
      deduplicationKey: randomUUID(),
      source: "SYNTHETIC_FIXTURE",
      state: "PAID",
      payloadDigest: "no-provider-call",
    },
  });
  await db.subscriptionPeriod.create({
    data: {
      invoiceId: invoice.id,
      organizationId: org.id,
      plan: "ENTERPRISE",
      startsAt: new Date("2026-10-01"),
      endsAt: new Date("2030-01-01"),
    },
  });
  record(
    "Upgraded production runtime creates a paid sale, fractional transfer and audited common prices; store restrictions hold",
  );
  const afterRelease = await snapshot(db);
  // Exact rollback candidate still executes the production migration guard, not a bypass.
  await run("pnpm", ["build"], candidate, {
    VERCEL: "1",
    VERCEL_ENV: "production",
    NEXTAUTH_URL: "https://localhost:3127",
  });
  assert.deepEqual(await snapshot(db), afterRelease);
  assert.equal(
    (await old.productImageStudioJob.findUniqueOrThrow({ where: { id: imageJob.id } })).id,
    imageJob.id,
  );
  record(
    "Old application production build succeeds against the upgraded ledger and changes no database rows",
  );
  const tools = await localBinaries();
  const dump = resolve(directory, `post-release-${stamp}.dump`);
  await run(tools.tool("pg_dump"), [
    "-h",
    "127.0.0.1",
    "-p",
    "55448",
    "-U",
    "bazaar_test",
    "-Fc",
    "-f",
    dump,
    databaseName,
  ]);
  const restoredName = databaseName + "_restore";
  await admin.$executeRawUnsafe(`CREATE DATABASE "${restoredName}"`);
  await run(tools.tool("pg_restore"), [
    "-h",
    "127.0.0.1",
    "-p",
    "55448",
    "-U",
    "bazaar_test",
    "-d",
    restoredName,
    dump,
  ]);
  const restored = new PrismaClient({
    datasourceUrl: url.replace(`/${databaseName}`, `/${restoredName}`),
  });
  try {
    assert.deepEqual(await snapshot(restored), afterRelease);
  } finally {
    await restored.$disconnect();
  }
  record(
    "Post-release backup restores into another empty disposable database with every table hash unchanged",
  );
  await start(candidate, 3127);
  const oldReceipt = await api(3127, "pos.sales.get", { saleId: newSale.receipt.id });
  assert.equal(Number(oldReceipt.totalKgs), 437.5);
  assert.equal(oldReceipt.lines.length, 1);
  const oldPrices = await api(3127, "products.storePricing", { productId: product.id });
  assert.equal(oldPrices.stores.find((s: any) => s.storeId === stores[1].id).effectivePriceKgs, 0);
  await assert.rejects(api(3127, "inventory.list", { storeId: stores[0].id }, false, staffCookie));
  assert.deepEqual(await snapshot(db), afterRelease);
  record(
    "Old runtime reads post-release receipt/prices and enforces store rights; boot and reads preserve every table hash",
  );
  await api(3127, "pos.sales.complete", newSale.request, true);
  await api(3127, "inventory.transfer", transferRequest, true);
  assert.deepEqual(await snapshot(db), afterRelease);
  record(
    "Paid sale and transfer retries across versions replay without duplicate payments, stock moves or other writes",
  );
  const oldSale = await sale(3127, register.id, product.id, 0.5);
  assert.equal(Number(oldSale.receipt.totalKgs), 175);
  await api(
    3127,
    "storePrices.upsert",
    { storeId: stores[0].id, productId: product.id, priceKgs: 360 },
    true,
  );
  const inherited = await db.priceBookStoreItem.findFirstOrThrow({
    where: { storeId: stores[0].id, productId: product.id },
  });
  assert.equal(inherited.retailShared, false);
  assert.equal(inherited.wholesaleShared, true);
  assert.equal(await db.customerOrder.count({ where: { status: "COMPLETED" } }), 2);
  assert.equal(await db.salePayment.count(), 2);
  assert.equal(
    Number(
      (
        await db.inventorySnapshot.findFirstOrThrow({
          where: { storeId: stores[0].id, productId: product.id },
        })
      ).onHand,
    ),
    96,
  );
  record(
    "Rolled-back runtime completes a new sale and changes a local price; new constraints/triggers remain compatible",
  );
  const reentered = await api(3124, "pos.sales.get", { saleId: oldSale.receipt.id });
  assert.equal(Number(reentered.totalKgs), 175);
  assert.equal(
    Number(
      (
        await db.storePrice.findFirstOrThrow({
          where: { storeId: stores[0].id, productId: product.id },
        })
      ).priceKgs,
    ),
    360,
  );
  record(
    "Returning to the new runtime preserves the rollback-period sale, payments, balances and individual price override",
  );
  const browser = await chromium.launch({ channel: "chrome" });
  const browserErrors: string[] = [];
  try {
    for (const port of [3124, 3127]) {
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 1440, height: 1000 },
      });
      await context.addCookies([
        {
          name: "__Secure-next-auth.session-token",
          value: token,
          url: `https://localhost:${port}`,
          secure: true,
        },
        { name: "NEXT_LOCALE", value: "ru", url: `https://localhost:${port}` },
      ]);
      const page = await context.newPage();
      page.on("pageerror", (e) => browserErrors.push(e.message));
      for (const path of ["/dashboard", "/products", "/pos/history", "/inventory/transfers"]) {
        const response = await page.goto(`https://localhost:${port}${path}`, {
          waitUntil: "networkidle",
        });
        assert.equal(response?.status(), 200);
        assert(!page.url().includes("/login"), `${port}${path} redirected to ${page.url()}`);
        assert.equal(await page.locator("main").count(), 1);
      }
      await page.screenshot({
        path: resolve(directory, `runtime-${port}-desktop.png`),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`https://localhost:${port}/products`, { waitUntil: "networkidle" });
      await page.screenshot({
        path: resolve(directory, `runtime-${port}-mobile.png`),
        fullPage: true,
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  assert.deepEqual(browserErrors, []);
  record(
    "Both actual production bundles render dashboard/products/POS history/transfers and mobile products without page errors",
  );
  const final = await snapshot(db);
  const result = {
    status: "passed",
    base: manifest.base,
    release: manifest.release,
    candidateTree: manifest.candidateTree,
    retained: manifest.retained,
    databaseName,
    postgresPort: 55448,
    redisPort: 56398,
    applicationPorts: [3124, 3127],
    userRuntimePortUntouched: 3122,
    customerDatabaseUsed: false,
    productionChanges: false,
    providerCalls: 0,
    checks,
    tablesChecked: afterRelease.length,
    rowsBeforeRollback: afterRelease.reduce((s, t) => s + t.count, 0),
    tablesBeforeRollback: afterRelease,
    tablesAfterReentry: final,
    backupSha256: createHash("sha256")
      .update(await readFile(dump))
      .digest("hex"),
    limits: [
      "Local rehearsal of traffic switching; no Vercel production alias was changed.",
      "Application rollback retains the five migrations and subsequent business data; it is not a database time rewind.",
      "Providers and physical devices were not exercised.",
    ],
  };
  await writeFile(resolve(directory, "verification.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        ...result,
        retained: undefined,
        tablesBeforeRollback: undefined,
        tablesAfterReentry: undefined,
      },
      null,
      2,
    ),
  );
} finally {
  for (const child of children) child.kill("SIGTERM");
  await Promise.all([old.$disconnect(), db.$disconnect(), admin.$disconnect()]);
  await log.close();
}
