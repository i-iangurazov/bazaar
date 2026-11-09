import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createContractTerms } from "@/server/billing/contractTerms";
import { createTrialOffer } from "@/server/billing/trialPolicy";
import { previewTrialPreparation, prepareTrialSubscription } from "@/server/billing/trialPreparation";
import { assertSubscriptionSelectionReady } from "@/server/billing/subscriptionPreparation";
import { getOrganizationPlan } from "@/server/services/planLimits";
import { contractPlan } from "@/server/billing/contractTerms";
import { calculateSubscriptionQuote } from "@/server/billing/subscriptionQuotes";
import { LIFETIME_ORGANIZATION_IDS } from "@/server/billing/lifetimeOrganizations";
import { applyLoyaltyToOrder, releaseLoyaltyForOrder } from "@/server/services/loyalty/apply";
import { applyEntry, ensureAccount } from "@/server/services/loyalty/ledger";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function waitForProgramLock(mode: "FOR UPDATE" | "FOR SHARE") {
  // Observe a real PostgreSQL lock wait instead of assuming task ordering from
  // a sleep. This database belongs exclusively to the single-worker suite.
  for (let attempt = 0; attempt < 100; attempt++) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid()
          AND wait_event_type='Lock' AND query LIKE '%LoyaltyProgram%'
          AND position(${mode} in query)>0) AS waiting`;
    if (row?.waiting) return;
    await delay(20);
  }
  throw new Error(`Expected a programme ${mode} lock wait`);
}
async function fixture() {
  const f = await seedBase({ plan: "STARTER" });
  await prisma.user.updateMany({ where: { organizationId: f.org.id, id: { not: f.adminUser.id } }, data: { isActive: false } });
  const terms = createContractTerms("2026-11");
  await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-11",
    termsSnapshot: terms, trialOffer: createTrialOffer(terms) } });
  const end = new Date(Date.now() + 7 * 86400_000);
  await prisma.organization.update({ where: { id: f.org.id }, data: { subscriptionBillingMode: "SELF_SERVE",
    trialEndsAt: end, currentPeriodEndsAt: end } });
  const identity = { organizationId: f.org.id, actorId: f.adminUser.id, plan: "STARTER" as const };
  return { ...f, identity };
}
async function advanced(f: Awaited<ReturnType<typeof fixture>>) {
  await prisma.store.update({ where: { id: f.store.id }, data: { trackExpiryLots: true } });
  const bundle = await prisma.product.create({ data: { organizationId: f.org.id, name: "Trial bundle", sku: randomUUID(),
    unit: f.baseUnit.code, baseUnitId: f.baseUnit.id, isBundle: true } });
  await prisma.productBundleComponent.create({ data: { organizationId: f.org.id, bundleProductId: bundle.id,
    componentProductId: f.product.id, qty: 2 } });
  await prisma.stockLot.create({ data: { organizationId: f.org.id, storeId: f.store.id, productId: f.product.id,
    expiryDate: new Date("2030-01-01"), onHandQty: 12 } });
  return bundle;
}
async function loyaltyDraft(f: Awaited<ReturnType<typeof fixture>>) {
  const program = await prisma.loyaltyProgram.create({ data: { organizationId: f.org.id, enabled: true } });
  await prisma.loyaltyProgramStore.create({ data: { organizationId: f.org.id, programId: program.id, storeId: f.store.id } });
  const member = await prisma.loyaltyMember.create({ data: { organizationId: f.org.id, programId: program.id,
    contactKey: `email:${randomUUID()}@example.invalid` } });
  const account = await ensureAccount(prisma, { organizationId: f.org.id, programId: program.id, memberId: member.id });
  await prisma.$transaction(tx => applyEntry(tx, { organizationId: f.org.id, programId: program.id, memberId: member.id,
    accountId: account.id, type: "EARN", points: 500, eventKey: randomUUID() }));
  const order = await prisma.customerOrder.create({ data: { organizationId: f.org.id, storeId: f.store.id, number: "TRIAL-DRAFT",
    status: "DRAFT", subtotalKgs: 1000, totalKgs: 1000,
    lines: { create: { productId: f.product.id, qty: 1, unitPriceKgs: 1000, baseUnitPriceKgs: 1000, lineTotalKgs: 1000 } } } });
  await prisma.$transaction(tx => applyLoyaltyToOrder(tx, { organizationId: f.org.id, storeId: f.store.id,
    customerOrderId: order.id, memberId: member.id, requestedPoints: 100 }));
  return { program, member, account, order };
}

describeDb("explicit owner trial-to-paid preparation", () => {
  beforeEach(resetDatabase);
  it("previews before changing anything and safely prepares an expired trial without deleting inventory, lots or BOM", async () => {
    const f = await fixture(); const bundle = await advanced(f);
    const end = new Date(Date.now() - 1);
    await prisma.organization.update({ where: { id: f.org.id }, data: { trialEndsAt: end, currentPeriodEndsAt: end } });
    const before = {
      lots: await prisma.stockLot.findMany(), movements: await prisma.stockMovement.findMany(),
      snapshots: await prisma.inventorySnapshot.findMany(), components: await prisma.productBundleComponent.findMany(),
      organization: await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } }),
    };
    const preview = await previewTrialPreparation(f.identity);
    expect(preview.counts).toMatchObject({ stores: 1, bundles: 1, draftOrders: 0 });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: bundle.id } })).isBundle).toBe(true);
    await prepareTrialSubscription({ ...f.identity, confirmationToken: preview.confirmationToken, requestId: randomUUID() });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: bundle.id } })).isBundle).toBe(false);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: f.store.id } })).trackExpiryLots).toBe(false);
    expect(await prisma.stockLot.findMany()).toEqual(before.lots);
    expect(await prisma.stockMovement.findMany()).toEqual(before.movements);
    expect(await prisma.inventorySnapshot.findMany()).toEqual(before.snapshots);
    expect(await prisma.productBundleComponent.findMany()).toEqual(before.components);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).toEqual(before.organization);
    const org = await getOrganizationPlan(f.org.id);
    await expect(assertSubscriptionSelectionReady(org, contractPlan(org.contractTerms, "STARTER"), prisma)).resolves.toBeUndefined();
    await prepareTrialSubscription({ ...f.identity, confirmationToken: preview.confirmationToken, requestId: randomUUID() });
    expect(await prisma.auditLog.count({ where: { action: "TRIAL_SUBSCRIPTION_PREPARE" } })).toBe(1);
  });

  it("shows exact draft price changes then uses native loyalty cancellation without changing posted balances or ledger", async () => {
    const f = await fixture(); const l = await loyaltyDraft(f);
    const ledger = await prisma.loyaltyLedgerEntry.findMany();
    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: l.account.id } });
    expect(account.reservedPoints).toBe(100);
    const preview = await previewTrialPreparation(f.identity);
    expect(preview.counts).toMatchObject({ loyaltyPrograms: 1, draftOrders: 1, reservations: 1 });
    expect(preview.draftChanges).toEqual([{ orderId: l.order.id, number: l.order.number, beforeTotalKgs: "850.00", afterTotalKgs: "1000.00" }]);
    await prepareTrialSubscription({ ...f.identity, confirmationToken: preview.confirmationToken, requestId: randomUUID() });
    const after = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.balancePoints).toBe(account.balancePoints); expect(after.reservedPoints).toBe(0);
    expect(await prisma.loyaltyLedgerEntry.findMany()).toEqual(ledger);
    expect((await prisma.customerOrder.findUniqueOrThrow({ where: { id: l.order.id } })).totalKgs.toString()).toBe("1000");
    expect((await prisma.loyaltyProgram.findUniqueOrThrow({ where: { id: l.program.id } })).enabled).toBe(false);
    expect((await prisma.loyaltyOrderApplication.findUniqueOrThrow({ where: { customerOrderId: l.order.id } })).status).toBe("RELEASED");
  });

  it("rejects a stale preparation when an in-flight zero-point discount commits on a previously undiscovered draft", async () => {
    const f = await fixture(); const l = await loyaltyDraft(f);
    await prisma.$transaction(tx => releaseLoyaltyForOrder(tx, { customerOrderId: l.order.id }));
    const preview = await previewTrialPreparation(f.identity);
    expect(preview.counts.draftOrders).toBe(0);
    const applied = latch(); const releaseApply = latch();
    const application = prisma.$transaction(async tx => {
      await applyLoyaltyToOrder(tx, { organizationId: f.org.id, storeId: f.store.id,
        customerOrderId: l.order.id, memberId: l.member.id, requestedPoints: 0 });
      applied.resolve(); await releaseApply.promise;
    }, { timeout: 10_000 });
    const applying = application.then(() => ({ ok: true }), error => ({ error }));
    let preparing: ReturnType<typeof prepareTrialSubscription> | undefined;
    let preparationResult: Promise<{ ok: true } | { error: unknown }> | undefined;
    try {
      await Promise.race([applied.promise, applying.then(result => { if ("error" in result) throw result.error; })]);
      preparing = prepareTrialSubscription({ ...f.identity,
        confirmationToken: preview.confirmationToken, requestId: randomUUID() });
      preparationResult = preparing.then(() => ({ ok: true as const }), error => ({ error }));
      await waitForProgramLock("FOR UPDATE");
      releaseApply.resolve();
      expect(await applying).toEqual({ ok: true });
      const result = await preparationResult;
      expect(result).toMatchObject({ error: { message: "billingQuoteChanged" } });
      expect((await prisma.loyaltyProgram.findUniqueOrThrow({ where: { id: l.program.id } })).enabled).toBe(true);
      expect((await prisma.loyaltyOrderApplication.findUniqueOrThrow({ where: { customerOrderId: l.order.id } })).status).toBe("APPLIED");
      expect(await prisma.loyaltyReservation.count({ where: { status: "ACTIVE" } })).toBe(0);
      expect((await prisma.customerOrder.findUniqueOrThrow({ where: { id: l.order.id } })).totalKgs.toString()).toBe("950");
    } finally {
      releaseApply.resolve();
      await Promise.allSettled([applying, ...(preparationResult ? [preparationResult] : [])]);
    }
  }, 20_000);

  it("lets preparation finish first and prevents a waiting zero-point application from using the old enabled state", async () => {
    const f = await fixture(); const l = await loyaltyDraft(f);
    await prisma.$transaction(tx => releaseLoyaltyForOrder(tx, { customerOrderId: l.order.id }));
    const preview = await previewTrialPreparation(f.identity);
    const locked = latch(); const releaseLock = latch();
    const coordinator = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "LoyaltyProgram" WHERE id=${l.program.id} FOR UPDATE`;
      locked.resolve(); await releaseLock.promise;
    }, { timeout: 10_000 });
    const coordinating = coordinator.then(() => ({ ok: true }), error => ({ error }));
    let preparationResult: Promise<{ ok: true } | { error: unknown }> | undefined;
    let applicationResult: Promise<{ ok: true } | { error: unknown }> | undefined;
    try {
      await Promise.race([locked.promise, coordinating.then(result => { if ("error" in result) throw result.error; })]);
      preparationResult = prepareTrialSubscription({ ...f.identity,
        confirmationToken: preview.confirmationToken, requestId: randomUUID() })
        .then(() => ({ ok: true as const }), error => ({ error }));
      await waitForProgramLock("FOR UPDATE");
      applicationResult = prisma.$transaction(tx => applyLoyaltyToOrder(tx, {
        organizationId: f.org.id, storeId: f.store.id, customerOrderId: l.order.id,
        memberId: l.member.id, requestedPoints: 0,
      }), { timeout: 10_000 }).then(() => ({ ok: true as const }), error => ({ error }));
      await waitForProgramLock("FOR SHARE");
      releaseLock.resolve();
      expect(await coordinating).toEqual({ ok: true });
      expect(await preparationResult).toEqual({ ok: true });
      expect(await applicationResult).toMatchObject({ error: { message: "loyaltyDisabled" } });
      expect((await prisma.loyaltyProgram.findUniqueOrThrow({ where: { id: l.program.id } })).enabled).toBe(false);
      expect((await prisma.loyaltyOrderApplication.findUniqueOrThrow({ where: { customerOrderId: l.order.id } })).status).toBe("RELEASED");
      expect((await prisma.customerOrder.findUniqueOrThrow({ where: { id: l.order.id } })).totalKgs.toString()).toBe("1000");
      expect(await prisma.loyaltyReservation.count({ where: { status: "ACTIVE" } })).toBe(0);
    } finally {
      releaseLock.resolve();
      await Promise.allSettled([coordinating, ...(preparationResult ? [preparationResult] : []), ...(applicationResult ? [applicationResult] : [])]);
    }
  }, 20_000);

  it("never removes a promised discount or changes completed records outside a draft", async () => {
    const f = await fixture(); const l = await loyaltyDraft(f);
    await prisma.customerOrder.update({ where: { id: l.order.id }, data: { status: "CONFIRMED" } });
    const order = await prisma.customerOrder.findUniqueOrThrow({ where: { id: l.order.id } });
    await expect(previewTrialPreparation(f.identity)).rejects.toThrow("billingDowngradeNeedsPreparation");
    expect(await prisma.customerOrder.findUniqueOrThrow({ where: { id: l.order.id } })).toEqual(order);
    // Business includes loyalty, so this record never forces an unnecessary cancellation.
    expect((await previewTrialPreparation({ ...f.identity, plan: "BUSINESS" })).counts.draftOrders).toBe(0);
  });

  it("requires a fresh confirmation after the affected configuration changes", async () => {
    const f = await fixture(); await advanced(f);
    const preview = await previewTrialPreparation(f.identity);
    await prisma.product.create({ data: { organizationId: f.org.id, name: "Another bundle", sku: randomUUID(), unit: f.baseUnit.code,
      baseUnitId: f.baseUnit.id, isBundle: true, bundleComponents: { create: { organizationId: f.org.id, componentProductId: f.product.id, qty: 1 } } } });
    await expect(prepareTrialSubscription({ ...f.identity, confirmationToken: preview.confirmationToken, requestId: randomUUID() }))
      .rejects.toThrow("billingQuoteChanged");
    expect(await prisma.product.count({ where: { organizationId: f.org.id, isBundle: true } })).toBe(2);
  });

  it("rejects tampered, different-plan and different-owner confirmation tokens", async () => {
    const f = await fixture(); await advanced(f); const preview = await previewTrialPreparation(f.identity);
    await expect(prepareTrialSubscription({ ...f.identity, confirmationToken: preview.confirmationToken + "x", requestId: randomUUID() })).rejects.toThrow("billingQuoteChanged");
    await expect(prepareTrialSubscription({ ...f.identity, plan: "BUSINESS", confirmationToken: preview.confirmationToken, requestId: randomUUID() })).rejects.toThrow("billingQuoteChanged");
    await expect(prepareTrialSubscription({ ...f.identity, actorId: f.managerUser.id, confirmationToken: preview.confirmationToken, requestId: randomUUID() })).rejects.toThrow("billingQuoteChanged");
    expect((await prisma.store.findUniqueOrThrow({ where: { id: f.store.id } })).trackExpiryLots).toBe(true);
  });

  it.each(["managerUser", "staffUser", "cashierUser"] as const)("does not let %s or an unrelated identity prepare a subscription", async role => {
    const f = await fixture();
    await expect(previewTrialPreparation({ ...f.identity, actorId: f[role].id })).rejects.toThrow("forbidden");
    await expect(previewTrialPreparation({ ...f.identity, actorId: randomUUID() })).rejects.toThrow("forbidden");
  });

  it("does not convert manually approved access", async () => {
    const f = await fixture();
    await prisma.organization.update({ where: { id: f.org.id }, data: { subscriptionBillingMode: "MANUAL" } });
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } });
    await expect(previewTrialPreparation(f.identity)).rejects.toThrow("billingManualAccessProtected");
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).toEqual(before);
  });

  it.each([false, true])("never prepares an account with pending or paid invoice (paid=%s)", async paid => {
    const f = await fixture(); await advanced(f);
    const preview = await previewTrialPreparation(f.identity);
    const purchase = await calculateSubscriptionQuote(f.org.id, { plan: "ENTERPRISE", months: 1, action: "RENEW",
      extras: { stores: 0, productPacks: 0, userPacks: 0 } });
    const invoice = await prisma.subscriptionInvoice.create({ data: { organizationId: f.org.id, createdById: f.adminUser.id,
      idempotencyKey: randomUUID(), pendingSlot: paid ? null : f.org.id, plan: "ENTERPRISE", amountMinor: purchase.amountMinor,
      merchantId: "synthetic-preparation", isTest: false, status: paid ? "PAID" : "PENDING",
      providerPaymentId: paid ? randomUUID() : null, paidAt: paid ? new Date() : null, purchaseSnapshot: purchase,
      termsVersion: "synthetic", termsUrl: "https://example.invalid/terms", sellerName: "Synthetic seller",
      expiresAt: new Date(purchase.expiresAt) } });
    await expect(prepareTrialSubscription({ ...f.identity, confirmationToken: preview.confirmationToken, requestId: randomUUID() }))
      .rejects.toThrow("billingPaymentPending");
    expect((await prisma.store.findUniqueOrThrow({ where: { id: f.store.id } })).trackExpiryLots).toBe(true);
    expect((await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe(paid ? "PAID" : "PENDING");
  });

  it.each([...LIFETIME_ORGANIZATION_IDS])("never applies preparation to protected friend identity %s", async id => {
    const org = await prisma.organization.create({ data: { id, name: "Synthetic renamed friend", plan: "ENTERPRISE",
      subscriptionBillingMode: "SELF_SERVE", trialEndsAt: new Date(0), currentPeriodEndsAt: new Date(0) } });
    const owner = await prisma.user.create({ data: { organizationId: id, email: `${randomUUID()}@example.invalid`,
      name: "Protected owner", role: "ADMIN", isOrgOwner: true, passwordHash: "synthetic-unused" } });
    await prisma.subscriptionContract.create({ data: { organizationId: id, catalogVersion: "2026-11", lifetimeAccess: true,
      termsSnapshot: createContractTerms("2026-11") } });
    await expect(previewTrialPreparation({ organizationId: id, actorId: owner.id, plan: "STARTER" })).rejects.toThrow("billingManualAccessProtected");
    expect(await prisma.organization.findUniqueOrThrow({ where: { id } })).toEqual(org);
  });
});
