// Runs in a separate process with cwd and TSX_TSCONFIG_PATH pointing at the
// packaged version. Every application service and Prisma client comes from it.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PrismaClient, Prisma } from "@prisma/client";
import { assertSubscriptionRehearsalEnvironment } from "./subscription-rollback-environment";

assertSubscriptionRehearsalEnvironment();
const contextPath = process.env.SUBSCRIPTION_ROLLBACK_CONTEXT;
assert(contextPath, "Missing fixture context path");
const phase = process.argv[2];
assert(
  phase &&
    ["baseline-seed", "upgrade-seed", "old-runtime", "return-new", "backup-verify"].includes(phase),
  "Invalid rehearsal phase",
);
const load = (file: string) => import(pathToFileURL(resolve(process.cwd(), file)).href);
const require = createRequire(resolve(process.cwd(), "package.json"));
const Client = require("@prisma/client").PrismaClient as typeof PrismaClient;
const db = new Client({ datasourceUrl: process.env.DATABASE_URL });
type StoreFixture = {
  organizationId: string;
  storeId: string;
  productId: string;
  userId: string;
  registerId: string;
};
type InvoiceFixture = {
  invoiceId: string;
  organizationId: string;
  userId: string;
  months: 6 | 12;
  amountMinor: number;
  expectedEnd: string;
  idempotencyKey: string;
};
type State = {
  legacy: StoreFixture;
  lifetime: StoreFixture;
  checkout?: StoreFixture;
  replay?: Record<string, unknown>;
  longInvoices?: InvoiceFixture[];
  checks: string[];
  snapshots: Record<string, unknown>;
};
const state: State =
  phase === "baseline-seed"
    ? ({ checks: [], snapshots: {} } as unknown as State)
    : JSON.parse(await readFile(contextPath, "utf8"));
let providerAttempts = 0;
// Even accidentally enabled sandbox code cannot contact FreedomPay, AI, email
// or any other fetch provider. This process has only synthetic credentials.
globalThis.fetch = async () => {
  providerAttempts++;
  throw new Error("Rehearsal external request forbidden");
};
const record = (message: string) => state.checks.push(`${phase}: ${message}`);
type TableSnapshot = Record<string, { count: number; hash: string; columns: string[] }>;
async function snapshot(shape?: TableSnapshot) {
  const rows = await db.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const hashes: TableSnapshot = {};
  for (const { tablename } of rows) {
    if (shape && !shape[tablename]) continue;
    assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(tablename));
    const columns =
      shape?.[tablename]?.columns ??
      (
        await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${tablename} ORDER BY ordinal_position
    `
      ).map((row) => row.column_name);
    assert(columns.length && columns.every((column) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(column)));
    const projection = columns.map((column) => `"${column}"`).join(",");
    const values = await db.$queryRawUnsafe<Array<{ body: string }>>(
      `SELECT row_to_json(t)::text AS body FROM (SELECT ${projection} FROM public."${tablename}") t ORDER BY row_to_json(t)::text`,
    );
    hashes[tablename] = {
      columns,
      count: values.length,
      hash: createHash("sha256")
        .update(values.map((row) => row.body).join("\n"))
        .digest("hex"),
    };
  }
  return hashes;
}
async function seed(id?: string, terms?: unknown): Promise<StoreFixture> {
  const org = await db.organization.create({
    data: {
      ...(id ? { id } : {}),
      name: "Synthetic rollback business",
      plan: "STARTER",
      subscriptionStatus: "ACTIVE",
      currentPeriodEndsAt: new Date(Date.now() + 90 * 86400000),
      ...(terms
        ? {
            subscriptionBillingMode: "SELF_SERVE",
            subscriptionContract: {
              create: {
                catalogVersion: "2026-11",
                termsSnapshot: terms as Prisma.InputJsonValue,
              },
            },
          }
        : {}),
    },
  });
  const user = await db.user.create({
    data: {
      organizationId: org.id,
      email: `${randomUUID()}@example.invalid`,
      name: "Synthetic owner",
      role: "ADMIN",
      isOrgOwner: true,
      passwordHash: "synthetic-not-a-password",
      emailVerifiedAt: new Date(),
    },
  });
  const unit = await db.unit.create({
    data: { organizationId: org.id, code: "each", labelRu: "шт", labelKg: "даана" },
  });
  const store = await db.store.create({
    data: { organizationId: org.id, name: "Synthetic store", code: "R1" },
  });
  const product = await db.product.create({
    data: {
      organizationId: org.id,
      name: "Synthetic product",
      sku: "ROLLBACK-ONE",
      unit: unit.code,
      baseUnitId: unit.id,
      basePriceKgs: 100,
    },
  });
  await db.storeProduct.create({
    data: { organizationId: org.id, storeId: store.id, productId: product.id },
  });
  await db.storePrice.create({
    data: { organizationId: org.id, storeId: store.id, productId: product.id, priceKgs: 100 },
  });
  await db.storePriceTypes.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      retailPriceKgs: 100,
      wholesalePriceKgs: 90,
    },
  });
  await db.inventorySnapshot.create({
    data: { storeId: store.id, productId: product.id, onHand: 20, variantKey: "BASE" },
  });
  await db.productCost.create({
    data: { organizationId: org.id, productId: product.id, avgCostKgs: 50, costBasisQty: 20 },
  });
  await db.stockMovement.create({
    data: {
      storeId: store.id,
      productId: product.id,
      type: "RECEIVE",
      qtyDelta: 20,
      unitCostKgs: 50,
      lineTotalKgs: 1000,
      referenceType: "SUBSCRIPTION_ROLLBACK_FIXTURE",
      createdById: user.id,
    },
  });
  const register = await db.posRegister.create({
    data: { organizationId: org.id, storeId: store.id, code: "QA", name: "Synthetic register" },
  });
  return {
    organizationId: org.id,
    userId: user.id,
    storeId: store.id,
    productId: product.id,
    registerId: register.id,
  };
}
async function trade(f: StoreFixture, replay = false) {
  const pos = await load("src/server/services/pos.ts");
  const user = { id: f.userId, organizationId: f.organizationId, role: "ADMIN", isOrgOwner: true };
  if (replay && state.replay) {
    await pos.completePosSale(state.replay);
    return;
  }
  await pos.openRegisterShift({
    organizationId: f.organizationId,
    registerId: f.registerId,
    actorId: f.userId,
    openingCashKgs: 0,
    user,
    requestId: randomUUID(),
    idempotencyKey: `rollback-shift:${f.registerId}`,
  });
  const draft = await pos.createPosSaleDraft({
    organizationId: f.organizationId,
    registerId: f.registerId,
    actorId: f.userId,
    user,
    requestId: randomUUID(),
    lines: [{ productId: f.productId, qty: 1 }],
  });
  const sale = await pos.getPosSale({ organizationId: f.organizationId, saleId: draft.id, user });
  assert.equal(Number(sale.totalKgs), 100);
  const input = {
    organizationId: f.organizationId,
    saleId: draft.id,
    actorId: f.userId,
    user,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    payments: [{ method: "CASH", amountKgs: 100 }],
  };
  await pos.completePosSale(input);
  if (phase === "baseline-seed" && f === state.legacy) state.replay = input;
}
const fields = (invoice: InvoiceFixture) => ({
  pg_order_id: invoice.invoiceId,
  pg_payment_id: String(100 + invoice.months),
  pg_merchant_id: "12345",
  pg_currency: "KGS",
  pg_amount: (invoice.amountMinor / 100).toFixed(2),
  pg_result: "1",
  pg_testing_mode: "1",
  pg_captured: "1",
  pg_payment_method: "bankcard",
});

try {
  if (phase === "baseline-seed") {
    state.legacy = await seed();
    // A known protected ID is used solely in this empty local fixture, so the
    // actual rollout backfill (rather than a test-only update) grants lifetime.
    state.lifetime = await seed("cmldyo7dn0005btviqlnua4ii");
    await trade(state.legacy);
    await trade(state.lifetime);
    state.snapshots.beforeUpgrade = await snapshot();
    record("actual baseline POS services complete legacy and lifetime-fixture cash sales");
  } else if (phase === "upgrade-seed") {
    const before = state.snapshots.beforeUpgrade as Awaited<ReturnType<typeof snapshot>>;
    const after = await snapshot(before);
    for (const [table, value] of Object.entries(before))
      if (table !== "_prisma_migrations")
        assert.deepEqual(after[table], value, `Upgrade changed existing ${table}`);
    const plans = await load("src/server/services/planLimits.ts");
    assert.equal(
      (await plans.getOrganizationPlan(state.legacy.organizationId)).billingCatalogVersion,
      "2026-10",
    );
    assert.equal(
      (await plans.getOrganizationPlan(state.lifetime.organizationId)).lifetimeAccess,
      true,
    );
    await assert.rejects(
      db.organization.update({
        where: { id: state.lifetime.organizationId },
        data: { plan: "ENTERPRISE" },
      }),
    );
    record(
      "rollout preserves every baseline table hash; legacy terms and lifetime grants remain protected",
    );
    const { createContractTerms } = await load("src/server/billing/contractTerms.ts");
    const { calculateSubscriptionQuote } = await load("src/server/billing/subscriptionQuotes.ts");
    const payments = await load("src/server/billing/subscriptionPayments.ts");
    state.longInvoices = [];
    for (const months of [6, 12] as const) {
      const fixture = await seed(undefined, createContractTerms("2026-11"));
      const purchase = await calculateSubscriptionQuote(fixture.organizationId, {
        plan: "STARTER",
        months,
        action: "RENEW",
        extras: { stores: 0, productPacks: 0, userPacks: 0 },
      });
      const idempotencyKey = randomUUID();
      const invoice = await db.subscriptionInvoice.create({
        data: {
          organizationId: fixture.organizationId,
          pendingSlot: fixture.organizationId,
          createdById: fixture.userId,
          idempotencyKey,
          plan: "STARTER",
          amountMinor: purchase.amountMinor,
          merchantId: "12345",
          isTest: true,
          status: "PENDING",
          purchaseSnapshot: purchase,
          termsVersion: "synthetic-rehearsal",
          termsUrl: "https://example.invalid/terms",
          sellerName: "Synthetic seller",
          expiresAt: new Date(Date.now() + 15 * 60000),
        },
      });
      const info: InvoiceFixture = {
        invoiceId: invoice.id,
        organizationId: fixture.organizationId,
        userId: fixture.userId,
        amountMinor: purchase.amountMinor,
        months,
        expectedEnd: purchase.endsAt,
        idempotencyKey,
      };
      state.longInvoices.push(info);
      if (months === 6)
        await payments.applyVerifiedPayment({
          invoiceId: info.invoiceId,
          fields: fields(info),
          source: "CALLBACK",
        });
    }
    const paid = await db.subscriptionPeriod.findUniqueOrThrow({
      where: { invoiceId: state.longInvoices[0].invoiceId },
    });
    assert.equal(paid.endsAt.toISOString(), state.longInvoices[0].expectedEnd);
    record(
      "new service settles a six-month purchase; twelve-month pending purchase retained for old-version test",
    );
    // A separate self-serve business has no pending invoice, so the old
    // creation probe reaches the SQL snapshot guard instead of merely failing
    // the existing one-pending-checkout application rule.
    state.checkout = await seed(undefined, createContractTerms("2026-11"));
    state.snapshots.beforeOldRuntime = await snapshot();
  } else if (phase === "old-runtime") {
    const payments = await load("src/server/billing/subscriptionPayments.ts");
    assert.equal(
      (await payments.getSubscriptionPaymentState(state.legacy.organizationId)).available,
      false,
    );
    const [paid, pending] = state.longInvoices!;
    const before = await snapshot();
    await payments.applyVerifiedPayment({
      invoiceId: paid.invoiceId,
      fields: fields(paid),
      source: "CALLBACK",
    });
    await assert.rejects(
      payments.applyVerifiedPayment({
        invoiceId: pending.invoiceId,
        fields: fields(pending),
        source: "CALLBACK",
      }),
      /purchase snapshot/i,
    );
    assert.deepEqual(
      await snapshot(),
      before,
      "Old callback altered money, event, subscription or business rows",
    );
    record(
      "old paid callback is idempotent; old twelve-month callback fails atomically instead of granting one month",
    );
    assert(state.checkout, "Missing independent checkout fixture");
    const checkoutInput = {
      organizationId: state.checkout.organizationId,
      actorId: state.checkout.userId,
      plan: "STARTER",
      idempotencyKey: randomUUID(),
      termsVersion: "synthetic-rehearsal",
      expectedAmountMinor: 175000,
      locale: "ru",
      requestId: randomUUID(),
    };
    await assert.rejects(
      payments.createSubscriptionCheckout(checkoutInput),
      /billingPaymentsUnavailable/,
    );
    // Defense in depth: prove the actual old create path hits the SQL snapshot
    // guard before a provider request, even under synthetic sandbox readiness.
    const envBefore = { ...process.env };
    try {
      Object.assign(process.env, {
        BILLING_PAYMENTS_MODE: "sandbox",
        HARDENING_EXTERNAL_PROVIDER_MODE: "rehearsal",
        FREEDOMPAY_MERCHANT_ID: "12345",
        FREEDOMPAY_SECRET_KEY: "synthetic-not-a-real-merchant-secret",
        BILLING_PUBLIC_URL: "http://localhost:3161",
        BILLING_TERMS_URL: "http://localhost:3161/legal/offer",
        BILLING_TERMS_VERSION: "synthetic-rehearsal",
        BILLING_SELLER_NAME: "Synthetic seller",
      });
      await assert.rejects(
        payments.createSubscriptionCheckout(checkoutInput),
        /purchase snapshot/i,
      );
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key];
      Object.assign(process.env, envBefore);
    }
    assert.deepEqual(await snapshot(), before, "Rejected checkout changed data");
    record(
      "checkout is disabled; old snapshot-less invoice creation also fails before any provider call",
    );
    await trade(state.legacy, true);
    assert.deepEqual(await snapshot(), before, "Replayed baseline sale duplicated rows");
    await trade(state.legacy);
    await trade(state.lifetime);
    record(
      "old application services replay an old sale and complete new legacy/lifetime cash sales after upgrade",
    );
    state.snapshots.afterOldRuntime = await snapshot();
  } else if (phase === "return-new") {
    const pending = state.longInvoices![1];
    const payments = await load("src/server/billing/subscriptionPayments.ts");
    await payments.applyVerifiedPayment({
      invoiceId: pending.invoiceId,
      fields: fields(pending),
      source: "CALLBACK",
    });
    for (const info of state.longInvoices!) {
      const period = await db.subscriptionPeriod.findUniqueOrThrow({
        where: { invoiceId: info.invoiceId },
      });
      assert.equal(period.endsAt.toISOString(), info.expectedEnd);
      assert.equal((period.purchaseSnapshot as { months?: number }).months, info.months);
    }
    for (const fixture of [state.legacy, state.lifetime]) {
      assert.equal(
        await db.customerOrder.count({
          where: { organizationId: fixture.organizationId, status: "COMPLETED" },
        }),
        2,
      );
      assert.equal(
        Number(
          (
            await db.inventorySnapshot.findFirstOrThrow({
              where: { storeId: fixture.storeId, productId: fixture.productId, variantKey: "BASE" },
            })
          ).onHand,
        ),
        18,
      );
      const limits = await load("src/server/services/planLimits.ts");
      assert.equal(
        limits.resolveOrganizationAccessState(
          await limits.getOrganizationPlan(fixture.organizationId),
        ).hasAccess,
        true,
      );
    }
    record(
      "new runtime preserves rollback-period sales/stock and settles the pending purchase for all twelve agreed months",
    );
    state.snapshots.final = await snapshot();
  } else {
    assert.deepEqual(
      await snapshot(),
      state.snapshots.final,
      "Restored database differs from the complete post-rollback snapshot",
    );
    record(
      "complete post-rollback backup restores every table, payment snapshot, sale and balance unchanged into another empty disposable database",
    );
  }
  assert.equal(providerAttempts, 0, "A provider request was attempted");
  await writeFile(contextPath, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ phase, status: "passed", providerAttempts, checks: state.checks }));
} finally {
  await db.$disconnect();
  const serviceDb = await load("src/server/db/prisma.ts").catch(() => null);
  await serviceDb?.prisma.$disconnect();
  const redis = await load("src/server/redis.ts").catch(() => null);
  for (const client of [redis?.getRedisPublisher(), redis?.getRedisSubscriber()])
    if (client) await client.quit().catch(() => client.disconnect());
}
