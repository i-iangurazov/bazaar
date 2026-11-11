import { randomUUID } from "node:crypto";
import type { Prisma, SubscriptionInvoice, User } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import { getLogger } from "@/server/logging";
import { appRouter } from "@/server/trpc/routers/_app";
import { LIFETIME_ORGANIZATION_IDS } from "@/server/billing/lifetimeOrganizations";
import {
  lookupManualSubscriptionRefundInvoice,
  recordManualSubscriptionRefund,
} from "@/server/billing/manualSubscriptionRefunds";
import { goPayMerchantId } from "@/server/billing/paymentConfig";
import { calculateSubscriptionQuote } from "@/server/billing/subscriptionQuotes";
import type { PurchaseSnapshot } from "@/server/billing/purchaseSnapshot";
import { extendSubscriptionMonths } from "@/server/billing/paymentMath";
import { EMPTY_SUBSCRIPTION_EXTRAS } from "@/lib/billing/subscriptionPricing";
import { handleGoPayNotification } from "@/server/billing/goPayWebhook";
import {
  GOPAY_FIXTURE_API_KEY,
  GOPAY_FIXTURE_API_SECRET,
  GOPAY_FIXTURE_WEBHOOK_SECRET,
  goPayProtocolFixture,
} from "../helpers/gopayProtocolFixture";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
// SQL independently checks CURRENT_TIMESTAMP, so keep valid fixtures relative to
// the real clock rather than pretending PostgreSQL shares a distant fake date.
const now = new Date();
const paidAt = new Date(now.getTime() - 2 * 86_400_000);
const endsAt = extendSubscriptionMonths(paidAt, paidAt.getUTCDate(), 1);
const day = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
const today = day(now);
const paidDay = day(paidAt);
const beforePaidDay = day(new Date(now.getTime() - 3 * 86_400_000));
const futureDay = day(new Date(now.getTime() + 86_400_000));
const reason = "Synthetic executed bank transfer checked by the platform operator";
type InvoiceChanges = Partial<
  Pick<SubscriptionInvoice, "status" | "provider" | "isTest" | "paidAt" | "providerPaymentId">
>;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};
const settled = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );

describeDb("manual bank accounting for GoPay subscription refunds", () => {
  let f: Awaited<ReturnType<typeof seedBase>>;
  let operator: User;
  let owner: ReturnType<typeof createTestCaller>;
  let network: ReturnType<typeof vi.fn>;
  const purchases = new Map<string, PurchaseSnapshot>();

  const agreedPurchase = async (organizationId: string) => {
    // Protected identities exercise already-existing, pre-contract invoices.
    // The current checkout builder must not issue a new quote to those accounts.
    if (LIFETIME_ORGANIZATION_IDS.has(organizationId)) return null;
    const existing = purchases.get(organizationId);
    if (existing) return existing;
    await prisma.subscriptionContract.upsert({
      where: { organizationId },
      create: { organizationId, catalogVersion: "2026-11" },
      update: {},
    });
    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        subscriptionBillingMode: "SELF_SERVE",
        subscriptionStatus: "ACTIVE",
        trialEndsAt: null,
        currentPeriodEndsAt: null,
      },
    });
    const purchase = await calculateSubscriptionQuote(
      organizationId,
      {
        plan: "STARTER",
        months: 1,
        extras: EMPTY_SUBSCRIPTION_EXTRAS,
        action: "RENEW",
      },
      prisma,
      paidAt,
    );
    purchases.set(organizationId, purchase);
    await prisma.organization.update({
      where: { id: organizationId },
      data: { currentPeriodEndsAt: new Date(purchase.endsAt) },
    });
    return purchase;
  };

  const paidInvoice = async (
    options: {
      organizationId?: string;
      changes?: InvoiceChanges;
      eventSource?: string | null;
      period?: boolean;
    } = {},
  ) => {
    const organizationId = options.organizationId ?? f.org.id;
    const status = options.changes?.status ?? "PAID";
    const id = randomUUID().replace(/-/g, "");
    const purchase = await agreedPurchase(organizationId);
    return prisma.subscriptionInvoice.create({
      data: {
        id,
        organizationId,
        createdById: f.adminUser.id,
        idempotencyKey: randomUUID(),
        plan: "STARTER",
        amountMinor: purchase?.amountMinor ?? 200_000,
        ...(purchase ? { purchaseSnapshot: purchase } : {}),
        currency: "KGS",
        status,
        pendingSlot: status === "PENDING" || status === "CREATING" ? organizationId : null,
        provider: "GOPAY",
        providerOrderId: randomUUID().replace(/-/g, ""),
        merchantId: goPayMerchantId(GOPAY_FIXTURE_API_KEY),
        isTest: false,
        providerPaymentId: randomUUID().replace(/-/g, ""),
        paidAt,
        termsVersion: "synthetic-manual-refund-terms",
        termsUrl: "https://example.invalid/legal/offer",
        sellerName: "Synthetic subscription seller",
        expiresAt: new Date(paidAt.getTime() + 15 * 60_000),
        ...options.changes,
        ...(options.eventSource === null
          ? {}
          : {
              events: {
                create: {
                  deduplicationKey: `synthetic-paid:${id}`,
                  source: options.eventSource ?? "RECONCILIATION",
                  state: "PAID",
                  payloadDigest: "synthetic-provider-confirmation",
                },
              },
            }),
        ...(options.period === false
          ? {}
          : {
              period: {
                create: {
                  organization: { connect: { id: organizationId } },
                  plan: "STARTER",
                  startsAt: paidAt,
                  endsAt,
                  ...(purchase ? { purchaseSnapshot: purchase } : {}),
                },
              },
            }),
      },
      include: { period: true, events: true },
    });
  };
  const request = (
    invoiceId: string,
    changes: Partial<Parameters<typeof recordManualSubscriptionRefund>[0]> = {},
  ) => ({
    invoiceId,
    amountMinor: 50_000,
    bankOperationId: `SYNTHETIC-BANK-${randomUUID()}`,
    bankTransferredOn: today,
    reason,
    idempotencyKey: randomUUID(),
    actorId: operator.id,
    requestId: randomUUID(),
    ...changes,
  });
  const rows = (invoiceId?: string) =>
    prisma.manualSubscriptionRefund.findMany({
      where: invoiceId ? { invoiceId } : {},
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

  beforeEach(async () => {
    await resetDatabase();
    purchases.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    vi.stubEnv("BILLING_PAYMENTS_MODE", "disabled");
    vi.stubEnv("HARDENING_EXTERNAL_PROVIDER_MODE", "disabled");
    network = vi.fn(() => {
      throw new Error("Manual refund accounting must not call a provider");
    });
    vi.stubGlobal("fetch", network);
    f = await seedBase();
    await prisma.user.updateMany({
      where: { organizationId: f.org.id, id: { not: f.adminUser.id } },
      data: { isActive: false },
    });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: {
        subscriptionBillingMode: "SELF_SERVE",
        subscriptionStatus: "ACTIVE",
        trialEndsAt: null,
        currentPeriodEndsAt: endsAt,
      },
    });
    await prisma.subscriptionContract.create({
      data: { organizationId: f.org.id, catalogVersion: "2026-11" },
    });
    const operatorOrg = await prisma.organization.create({
      data: { name: "Synthetic platform operator organization" },
    });
    operator = await prisma.user.create({
      data: {
        organizationId: operatorOrg.id,
        email: "synthetic-refund-operator@example.invalid",
        name: "Synthetic refund operator",
        passwordHash: "synthetic-not-a-login",
        role: "ADMIN",
        emailVerifiedAt: now,
      },
    });
    owner = createTestCaller({
      ...operator,
      organizationId: operatorOrg.id,
      isPlatformOwner: true,
    });
  });
  afterEach(() => {
    expect(network).not.toHaveBeenCalled();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("looks up the actual provider order and exposes the immutable paid facts without checking GoPay", async () => {
    const invoice = await paidInvoice();
    expect(operator.organizationId).not.toBe(invoice.organizationId);
    const result = await lookupManualSubscriptionRefundInvoice({
      orderId: invoice.providerOrderId!,
    });
    expect(result).toMatchObject({
      invoiceId: invoice.id,
      orderId: invoice.providerOrderId,
      organization: { id: f.org.id },
      amountMinor: 200_000,
      currency: "KGS",
      paidAt,
      refundedMinor: 0,
      remainingRefundableMinor: 200_000,
      period: { startsAt: paidAt, endsAt },
      refunds: [],
    });
    await expect(
      lookupManualSubscriptionRefundInvoice({ orderId: randomUUID().replace(/-/g, "") }),
    ).rejects.toHaveProperty("message", "billingManualRefundInvoiceNotFound");
    expect(await rows()).toHaveLength(0);
  });

  it("records partial then full repayment, caps the sum, and leaves provider history, periods and access unchanged", async () => {
    const invoice = await paidInvoice();
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } });
    await expect(
      recordManualSubscriptionRefund(request(invoice.id, { amountMinor: 200_001 })),
    ).rejects.toHaveProperty("message", "billingManualRefundAmountInvalid");
    const partial = await recordManualSubscriptionRefund(request(invoice.id));
    expect(partial).toMatchObject({ refundedMinor: 50_000, remainingRefundableMinor: 150_000 });
    expect(partial.refunds).toHaveLength(1);
    expect(partial.refunds[0]).toMatchObject({
      amountMinor: 50_000,
      recordedById: operator.id,
      proofType: "OPERATOR_ATTESTATION",
      bankTransferredOn: today,
      reason,
    });
    await expect(
      recordManualSubscriptionRefund(request(invoice.id, { amountMinor: 150_001 })),
    ).rejects.toHaveProperty("message", "billingManualRefundAmountInvalid");
    const full = await recordManualSubscriptionRefund(
      request(invoice.id, { amountMinor: 150_000 }),
    );
    expect(full).toMatchObject({ refundedMinor: 200_000, remainingRefundableMinor: 0 });
    expect(full.refunds).toHaveLength(2);
    expect((await rows(invoice.id)).reduce((sum, row) => sum + row.amountMinor, 0)).toBe(200_000);
    await expect(
      recordManualSubscriptionRefund(request(invoice.id, { amountMinor: 1 })),
    ).rejects.toHaveProperty("message", "billingManualRefundAmountInvalid");
    expect(
      await prisma.subscriptionInvoice.findUniqueOrThrow({
        where: { id: invoice.id },
        include: { period: true, events: true },
      }),
    ).toEqual(invoice);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).toEqual(
      organization,
    );
    expect(await prisma.subscriptionPaymentNotification.count()).toBe(0);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
    expect(await prisma.subscriptionPaymentEvent.count({ where: { state: { not: "PAID" } } })).toBe(
      0,
    );
  });

  it("replays the same normalized bank operation and UUID without another ledger row or audit", async () => {
    const invoice = await paidInvoice();
    const firstRequest = request(invoice.id, {
      bankOperationId: "  ＳＹＮ Bank ００１  ",
      reason: ` ${reason} `,
    });
    const first = await recordManualSubscriptionRefund(firstRequest);
    const audits = await prisma.auditLog.count();
    expect(audits).toBe(1);
    const repeated = await recordManualSubscriptionRefund({
      ...firstRequest,
      idempotencyKey: firstRequest.idempotencyKey.toUpperCase(),
      bankOperationId: "synbank001",
      reason,
      requestId: randomUUID(),
    });
    expect(repeated).toEqual(first);
    expect(await rows()).toHaveLength(1);
    expect(await prisma.auditLog.count()).toBe(audits);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
  });

  it("rejects a reused idempotency key with changed money, reason, bank date or invoice", async () => {
    const invoice = await paidInvoice();
    const other = await paidInvoice();
    const original = request(invoice.id);
    await recordManualSubscriptionRefund(original);
    for (const change of [
      { amountMinor: 50_001 },
      { reason: "Different synthetic refund reason" },
      { bankTransferredOn: paidDay },
      { invoiceId: other.id },
    ]) {
      await expect(
        recordManualSubscriptionRefund({ ...original, ...change, requestId: randomUUID() }),
      ).rejects.toHaveProperty("message", "billingManualRefundIdempotencyConflict");
    }
    expect(await rows()).toHaveLength(1);
  });

  it("cannot attach one normalized bank transfer to a second invoice or organization", async () => {
    const invoice = await paidInvoice();
    await recordManualSubscriptionRefund(request(invoice.id, { bankOperationId: "Syn Bank 002" }));
    const otherOrg = await prisma.organization.create({
      data: { name: "Other synthetic refund tenant" },
    });
    const other = await paidInvoice({ organizationId: otherOrg.id });
    for (const invoiceId of [invoice.id, other.id]) {
      await expect(
        recordManualSubscriptionRefund(
          request(invoiceId, { bankOperationId: "ＳＹＮＢＡＮＫ００２" }),
        ),
      ).rejects.toHaveProperty("message", "billingManualRefundBankOperationUsed");
    }
    expect(await rows()).toHaveLength(1);
  });

  it("serializes two valid-looking bank transfers so their combined value never exceeds the paid amount", async () => {
    const invoice = await paidInvoice();
    const attempts = await Promise.allSettled([
      recordManualSubscriptionRefund(request(invoice.id, { amountMinor: 125_000 })),
      recordManualSubscriptionRefund(request(invoice.id, { amountMinor: 125_000 })),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = attempts.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({
      message: "billingManualRefundAmountInvalid",
    });
    expect((await rows(invoice.id)).map((row) => row.amountMinor)).toEqual([125_000]);
    expect(
      await prisma.auditLog.count({ where: { action: "SUBSCRIPTION_MANUAL_REFUND_RECORDED" } }),
    ).toBe(1);
    expect(
      await lookupManualSubscriptionRefundInvoice({ orderId: invoice.providerOrderId! }),
    ).toMatchObject({ refundedMinor: 125_000, remainingRefundableMinor: 75_000 });
  });

  it("deduplicates concurrent identical submissions before a second bank accounting entry is created", async () => {
    const invoice = await paidInvoice();
    const original = request(invoice.id);
    const [a, b] = await Promise.all([
      recordManualSubscriptionRefund(original),
      recordManualSubscriptionRefund({ ...original, requestId: randomUUID() }),
    ]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ refundedMinor: 50_000, remainingRefundableMinor: 150_000 });
    expect(await rows()).toHaveLength(1);
    expect(
      await prisma.auditLog.count({ where: { action: "SUBSCRIPTION_MANUAL_REFUND_RECORDED" } }),
    ).toBe(1);
  });

  it("refreshes the trigger SUM after a raw READ COMMITTED insert waits behind an uncommitted refund", async () => {
    const invoice = await paidInvoice();
    const firstInserted = deferred<number>();
    const releaseFirst = deferred<void>();
    const insert = (tx: Prisma.TransactionClient, suffix: string) => tx.$executeRaw`
      INSERT INTO "ManualSubscriptionRefund" (
        id, "organizationId", "invoiceId", "amountMinor", "bankOperationId", "bankOperationKey",
        "bankTransferredOn", reason, "idempotencyKey", "recordedById", "proofType"
      ) VALUES (
        ${randomUUID()}, ${invoice.organizationId}, ${invoice.id}, ${125_000},
        ${`SYNTHETIC-RAW-${suffix}`}, ${`SYNTHETIC-RAW-${suffix}`}, ${today}::date,
        ${reason}, ${randomUUID()}::uuid, ${operator.id}, 'OPERATOR_ATTESTATION'
      )
    `;
    const options = { isolationLevel: "ReadCommitted" as const, maxWait: 5_000, timeout: 10_000 };
    const first = settled(
      prisma.$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        await insert(tx, "FIRST");
        firstInserted.resolve(pid);
        await releaseFirst.promise;
      }, options),
    );
    void first.then((result) => {
      if (result.status === "rejected") firstInserted.reject(result.reason);
    });
    let second: ReturnType<typeof settled<number>> | undefined;
    try {
      const firstPid = await firstInserted.promise;
      const secondStarted = deferred<number>();
      second = settled(
        prisma.$transaction(async (tx) => {
          const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          secondStarted.resolve(pid);
          return insert(tx, "SECOND");
        }, options),
      );
      void second.then((result) => {
        if (result.status === "rejected") secondStarted.reject(result.reason);
      });
      const secondPid = await secondStarted.promise;
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const [state] = await prisma.$queryRaw<{ blocked: boolean }[]>`
          SELECT ${firstPid}::int = ANY(pg_blocking_pids(${secondPid}::int)) AS blocked
        `;
        if (state.blocked) {
          blocked = true;
          break;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      // The second INSERT really started before the first commit. No service
      // precheck or explicit caller lock can hide a stale BEFORE-trigger SUM.
      expect(blocked).toBe(true);
      releaseFirst.resolve(undefined);
      expect(await first).toMatchObject({ status: "fulfilled" });
      expect(await second).toMatchObject({
        status: "rejected",
        reason: {
          code: "P2010",
          meta: {
            code: "23514",
            message: expect.stringContaining("Manual refunds exceed the original payment"),
          },
        },
      });
      expect((await rows(invoice.id)).map((row) => row.amountMinor)).toEqual([125_000]);
      expect(
        await lookupManualSubscriptionRefundInvoice({ orderId: invoice.providerOrderId! }),
      ).toMatchObject({ refundedMinor: 125_000, remainingRefundableMinor: 75_000 });
    } finally {
      releaseFirst.resolve(undefined);
      await Promise.all([first, ...(second ? [second] : [])]);
    }
  }, 15_000);

  it("rejects an otherwise valid raw REPEATABLE READ refund without creating a ledger or audit entry", async () => {
    const invoice = await paidInvoice();
    const auditCount = await prisma.auditLog.count();
    await expect(
      prisma.$transaction(
        (tx) => tx.$executeRaw`
          INSERT INTO "ManualSubscriptionRefund" (
            id, "organizationId", "invoiceId", "amountMinor", "bankOperationId", "bankOperationKey",
            "bankTransferredOn", reason, "idempotencyKey", "recordedById", "proofType"
          ) VALUES (
            ${randomUUID()}, ${invoice.organizationId}, ${invoice.id}, ${125_000},
            'SYNTHETIC-RAW-RR', 'SYNTHETIC-RAW-RR', ${today}::date,
            ${reason}, ${randomUUID()}::uuid, ${operator.id}, 'OPERATOR_ATTESTATION'
          )
        `,
        { isolationLevel: "RepeatableRead" },
      ),
    ).rejects.toMatchObject({
      code: "P2010",
      meta: {
        code: "23514",
        message: expect.stringContaining(
          "Manual subscription refunds require READ COMMITTED isolation",
        ),
      },
    });
    expect(await rows()).toHaveLength(0);
    expect(await prisma.auditLog.count()).toBe(auditCount);
    expect(
      await prisma.subscriptionInvoice.findUniqueOrThrow({
        where: { id: invoice.id },
        include: { period: true, events: true },
      }),
    ).toEqual(invoice);
  });

  it("accepts only positive safe integer minor units and never rounds an invalid money input", async () => {
    const invoice = await paidInvoice();
    for (const amountMinor of [
      0,
      -1,
      0.5,
      Number.NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      "50000" as unknown as number,
    ]) {
      await expect(
        recordManualSubscriptionRefund(request(invoice.id, { amountMinor })),
        String(amountMinor),
      ).rejects.toHaveProperty("message", "billingManualRefundAmountInvalid");
    }
    expect(await rows()).toHaveLength(0);
    expect(
      await recordManualSubscriptionRefund(request(invoice.id, { amountMinor: 1 })),
    ).toMatchObject({ refundedMinor: 1, remainingRefundableMinor: 199_999 });
  });

  it("rejects invalid dates, unsafe bank references and missing reasons before writing accounting", async () => {
    const invoice = await paidInvoice();
    for (const bankTransferredOn of [
      "",
      "2026-2-01",
      "2026-02-30",
      "2026-13-01",
      beforePaidDay,
      futureDay,
    ]) {
      await expect(
        recordManualSubscriptionRefund(request(invoice.id, { bankTransferredOn })),
        bankTransferredOn,
      ).rejects.toHaveProperty("message", "billingManualRefundDateInvalid");
    }
    for (const bankOperationId of [
      "",
      "ab",
      "x".repeat(121),
      "BANK\nREFERENCE",
      "BANK\u0000REFERENCE",
    ]) {
      await expect(
        recordManualSubscriptionRefund(request(invoice.id, { bankOperationId })),
      ).rejects.toHaveProperty("message", "billingManualRefundBankOperationInvalid");
    }
    for (const invalidReason of ["", "too short", "x".repeat(501)]) {
      await expect(
        recordManualSubscriptionRefund(request(invoice.id, { reason: invalidReason })),
      ).rejects.toHaveProperty("message", "billingManualRefundReasonInvalid");
    }
    for (const idempotencyKey of [
      "",
      "synthetic-non-uuid",
      "00000000-0000-0000-0000-00000000000x",
    ]) {
      await expect(
        recordManualSubscriptionRefund(request(invoice.id, { idempotencyKey })),
      ).rejects.toHaveProperty("message", "billingManualRefundIdempotencyInvalid");
    }
    expect(await rows()).toHaveLength(0);
  });

  it("refuses unpaid, test, historical other-provider, unverified and unbound invoice records", async () => {
    for (const options of [
      { changes: { status: "PENDING" as const } },
      { changes: { status: "REVIEW" as const } },
      { changes: { status: "RESOLVED" as const } },
      { changes: { isTest: true } },
      { changes: { provider: "FREEDOMPAY" as const } },
      { changes: { paidAt: null } },
      { changes: { paidAt: new Date(now.getTime() + 1000) } },
      { changes: { providerPaymentId: null } },
      { eventSource: null },
      { eventSource: "MANUAL" },
      { period: false },
    ]) {
      const invoice = await paidInvoice(options);
      await expect(recordManualSubscriptionRefund(request(invoice.id))).rejects.toHaveProperty(
        "message",
        "billingManualRefundNotEligible",
      );
    }
    expect(await rows()).toHaveLength(0);
  });

  it("preserves every protected lifetime identity and an unlisted lifetime contract", async () => {
    for (const id of LIFETIME_ORGANIZATION_IDS) {
      await prisma.organization.create({
        data: { id, name: "Renamed synthetic protected organization" },
      });
      const invoice = await paidInvoice({ organizationId: id });
      await expect(recordManualSubscriptionRefund(request(invoice.id))).rejects.toHaveProperty(
        "message",
        "billingLifetimeProtected",
      );
    }
    const invoice = await paidInvoice();
    await prisma.subscriptionContract.update({
      where: { organizationId: f.org.id },
      data: { lifetimeAccess: true },
    });
    await expect(recordManualSubscriptionRefund(request(invoice.id))).rejects.toHaveProperty(
      "message",
      "billingLifetimeProtected",
    );
    expect(await rows()).toHaveLength(0);
    expect(
      (await prisma.subscriptionContract.findUniqueOrThrow({ where: { organizationId: f.org.id } }))
        .lifetimeAccess,
    ).toBe(true);
  });

  it("continues accounting for an ordinary paid invoice after access is canceled or new checkout is disabled", async () => {
    const invoice = await paidInvoice();
    await prisma.organization.update({
      where: { id: f.org.id },
      data: {
        subscriptionStatus: "CANCELED",
        subscriptionBillingMode: "MANUAL",
        currentPeriodEndsAt: paidAt,
      },
    });
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } });
    expect(await recordManualSubscriptionRefund(request(invoice.id))).toMatchObject({
      refundedMinor: 50_000,
    });
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).toEqual(
      organization,
    );
  });

  it("requires a platform operator and explicit attestation for lookup and recording", async () => {
    const invoice = await paidInvoice();
    const original = request(invoice.id);
    const mutation = {
      invoiceId: invoice.id,
      amountMinor: original.amountMinor,
      bankOperationId: original.bankOperationId,
      bankTransferredOn: original.bankTransferredOn,
      reason: original.reason,
      idempotencyKey: original.idempotencyKey,
      confirmed: true as const,
    };
    for (const user of [undefined, f.adminUser, f.managerUser, f.staffUser, f.cashierUser]) {
      const caller = createTestCaller(
        user
          ? { ...user, organizationId: f.org.id, isOrgOwner: user.id === f.adminUser.id }
          : undefined,
      );
      const code = user ? "FORBIDDEN" : "UNAUTHORIZED";
      await expect(
        caller.platformOwner.refundInvoice({ orderId: invoice.providerOrderId! }),
      ).rejects.toHaveProperty("code", code);
      await expect(caller.platformOwner.recordManualRefund(mutation)).rejects.toHaveProperty(
        "code",
        code,
      );
    }
    await expect(
      owner.platformOwner.recordManualRefund({ ...mutation, confirmed: false as true }),
    ).rejects.toHaveProperty("code", "BAD_REQUEST");
    expect(await rows()).toHaveLength(0);
    expect(
      await owner.platformOwner.refundInvoice({ orderId: invoice.providerOrderId! }),
    ).toMatchObject({ invoiceId: invoice.id });
    expect(await owner.platformOwner.recordManualRefund(mutation)).toMatchObject({
      refundedMinor: 50_000,
    });
    expect((await rows())[0].recordedById).toBe(operator.id);
  });

  it("forbids an impersonating operator before either endpoint reads or writes money history", async () => {
    const invoice = await paidInvoice();
    const authUser = {
      ...operator,
      organizationId: operator.organizationId!,
      isPlatformOwner: true,
      isOrgOwner: false,
    };
    const caller = appRouter.createCaller({
      prisma,
      user: authUser,
      impersonator: authUser,
      impersonationSessionId: "synthetic-refund-impersonation",
      ip: null,
      requestId: randomUUID(),
      logger: getLogger(),
    });
    await expect(
      caller.platformOwner.refundInvoice({ orderId: invoice.providerOrderId! }),
    ).rejects.toHaveProperty("code", "FORBIDDEN");
    const original = request(invoice.id);
    await expect(
      caller.platformOwner.recordManualRefund({
        invoiceId: invoice.id,
        amountMinor: original.amountMinor,
        bankOperationId: original.bankOperationId,
        bankTransferredOn: original.bankTransferredOn,
        reason,
        idempotencyKey: original.idempotencyKey,
        confirmed: true,
      }),
    ).rejects.toHaveProperty("code", "FORBIDDEN");
    expect(await rows()).toHaveLength(0);
  });

  it("protects bank accounting, tenant binding and its audit from direct database edits", async () => {
    const invoice = await paidInvoice();
    await recordManualSubscriptionRefund(request(invoice.id));
    const [recorded] = await rows(invoice.id);
    const audits = await prisma.auditLog.findMany({
      where: {
        action: "SUBSCRIPTION_MANUAL_REFUND_RECORDED",
        entity: "ManualSubscriptionRefund",
        entityId: recorded.id,
      },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorId).toBe(operator.id);
    await expect(
      prisma.manualSubscriptionRefund.update({
        where: { id: recorded.id },
        data: { amountMinor: 50_001 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.manualSubscriptionRefund.delete({ where: { id: recorded.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.auditLog.update({
        where: { id: audits[0].id },
        data: { entity: "Synthetic tampered record" },
      }),
    ).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: audits[0].id } })).rejects.toThrow();
    const direct = {
      invoiceId: invoice.id,
      organizationId: invoice.organizationId,
      amountMinor: 150_001,
      bankOperationId: "SYNTHETIC-DIRECT-CAP",
      bankOperationKey: "SYNTHETIC-DIRECT-CAP",
      bankTransferredOn: new Date(`${today}T00:00:00Z`),
      reason,
      idempotencyKey: randomUUID(),
      recordedById: operator.id,
      proofType: "OPERATOR_ATTESTATION",
    };
    await expect(prisma.manualSubscriptionRefund.create({ data: direct })).rejects.toThrow();
    const other = await prisma.organization.create({
      data: { name: "Synthetic cross-org accounting guard" },
    });
    await expect(
      prisma.manualSubscriptionRefund.create({
        data: {
          ...direct,
          organizationId: other.id,
          amountMinor: 1,
          idempotencyKey: randomUUID(),
          bankOperationId: "SYNTHETIC-CROSSORG",
          bankOperationKey: "SYNTHETIC-CROSSORG",
        },
      }),
    ).rejects.toThrow();
    expect(await rows(invoice.id)).toEqual([recorded]);
    expect(await prisma.auditLog.findUniqueOrThrow({ where: { id: audits[0].id } })).toEqual(
      audits[0],
    );
  });

  it("removes a partially refunded invoice from confirmed paid MRR without changing its paid access", async () => {
    const invoice = await paidInvoice();
    expect(await owner.platformOwner.summary()).toMatchObject({
      organizationsPaid: 1,
      confirmedPaidMrrKgs: 2000,
    });
    await recordManualSubscriptionRefund(request(invoice.id, { amountMinor: 1 }));
    expect(await owner.platformOwner.summary()).toMatchObject({
      organizationsPaid: 0,
      confirmedPaidMrrKgs: 0,
    });
    expect(
      await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } }),
    ).toMatchObject({ status: "PAID", amountMinor: 200_000 });
    expect(
      await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { invoiceId: invoice.id } }),
    ).toEqual(invoice.period);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).toMatchObject({
      subscriptionStatus: "ACTIVE",
      currentPeriodEndsAt: endsAt,
    });
  });

  it("shows each organization only its own refund amounts and dates while hiding internal bank and operator details", async () => {
    const invoice = await paidInvoice();
    const original = request(invoice.id);
    const recorded = await recordManualSubscriptionRefund(original);
    const other = await prisma.organization.create({
      data: { name: "Synthetic other refund history tenant" },
    });
    const otherUser = await prisma.user.create({
      data: {
        organizationId: other.id,
        email: "other-refund-history@example.invalid",
        name: "Synthetic other invoice owner",
        passwordHash: "synthetic-not-a-login",
        role: "ADMIN",
        isOrgOwner: true,
      },
    });
    const otherInvoice = await paidInvoice({ organizationId: other.id });
    await recordManualSubscriptionRefund(request(otherInvoice.id, { amountMinor: 75_000 }));
    const customer = createTestCaller({
      ...f.adminUser,
      organizationId: f.org.id,
      isOrgOwner: true,
    });
    const otherCustomer = createTestCaller({
      ...otherUser,
      organizationId: other.id,
      isOrgOwner: true,
    });
    const history = await customer.billing.payments.invoices({});
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      id: invoice.id,
      orderId: invoice.providerOrderId,
      status: "PAID",
      amountMinor: 200_000,
      refundedMinor: 50_000,
    });
    expect(history.items[0].refunds).toEqual([
      {
        id: recorded.refunds[0].id,
        amountMinor: 50_000,
        bankTransferredOn: today,
        createdAt: recorded.refunds[0].createdAt,
      },
    ]);
    expect(Object.keys(history.items[0].refunds[0]).sort()).toEqual([
      "amountMinor",
      "bankTransferredOn",
      "createdAt",
      "id",
    ]);
    const publicView = JSON.stringify(history);
    expect(publicView).not.toContain(original.bankOperationId);
    expect(publicView).not.toContain(reason);
    expect(publicView).not.toContain(operator.id);
    expect((await otherCustomer.billing.payments.invoices({})).items).toEqual([
      expect.objectContaining({ id: otherInvoice.id, refundedMinor: 75_000 }),
    ]);
    await expect(
      customer.billing.payments.invoices({ cursor: otherInvoice.id }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
    await expect(
      otherCustomer.billing.payments.invoices({ cursor: invoice.id }),
    ).rejects.toHaveProperty("code", "NOT_FOUND");
  });

  it("retains full bank refund history when GoPay still reports COMMITTED and repeats its callback", async () => {
    const invoice = await paidInvoice();
    const recorded = await recordManualSubscriptionRefund(
      request(invoice.id, { amountMinor: 200_000 }),
    );
    expect(network).not.toHaveBeenCalled();
    for (const [key, value] of Object.entries({
      GOPAY_API_KEY: GOPAY_FIXTURE_API_KEY,
      GOPAY_API_SECRET: GOPAY_FIXTURE_API_SECRET,
      GOPAY_WEBHOOK_SECRET: GOPAY_FIXTURE_WEBHOOK_SECRET,
      HARDENING_EXTERNAL_PROVIDER_MODE: "sandbox",
      VERCEL_ENV: "development",
    }))
      vi.stubEnv(key, value);
    const fixture = goPayProtocolFixture({ isTest: false });
    const payment = {
      payment_id: invoice.providerPaymentId!,
      order_id: invoice.providerOrderId!,
      amount: "2000.00",
      status: "COMMITTED" as const,
      checkout_url: `https://pay.gopay.kg/p/${invoice.providerPaymentId}/`,
      created_at: paidAt.toISOString(),
      expires_at: invoice.expiresAt.toISOString(),
      committed_at: paidAt.toISOString(),
      testing_mode: false,
    };
    fixture.payments.set(payment.order_id, payment);
    vi.stubGlobal("fetch", fixture.transport);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await handleGoPayNotification(fixture.notification(payment))).status).toBe(200);
    }
    expect(fixture.transport).toHaveBeenCalledTimes(2);
    for (const [url] of fixture.transport.mock.calls)
      expect(new URL(String(url)).pathname).toBe("/v1/payments/query");
    const history = await lookupManualSubscriptionRefundInvoice({
      orderId: invoice.providerOrderId!,
    });
    expect(history.refunds).toEqual(recorded.refunds);
    expect(history).toMatchObject({
      refundedMinor: 200_000,
      remainingRefundableMinor: 0,
      amountMinor: 200_000,
    });
    expect(
      await prisma.subscriptionPeriod.findUniqueOrThrow({ where: { invoiceId: invoice.id } }),
    ).toEqual(invoice.period);
    expect(await prisma.subscriptionPeriod.count()).toBe(1);
    expect(
      await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } }),
    ).toMatchObject({ status: "PAID", provider: "GOPAY", paidAt, amountMinor: 200_000 });
    const originalEvent = invoice.events[0];
    expect(
      await prisma.subscriptionPaymentEvent.findUniqueOrThrow({ where: { id: originalEvent.id } }),
    ).toEqual(originalEvent);
    expect(await prisma.subscriptionPaymentEvent.count({ where: { state: { not: "PAID" } } })).toBe(
      0,
    );
    expect(await prisma.subscriptionPaymentNotification.count()).toBe(0);
    expect(await owner.platformOwner.summary()).toMatchObject({
      organizationsPaid: 0,
      confirmedPaidMrrKgs: 0,
    });
    const customer = createTestCaller({
      ...f.adminUser,
      organizationId: f.org.id,
      isOrgOwner: true,
    });
    expect((await customer.billing.payments.invoices({})).items).toContainEqual(
      expect.objectContaining({
        id: invoice.id,
        status: "PAID",
        provider: "GOPAY",
        amountMinor: 200_000,
        refundedMinor: 200_000,
      }),
    );
  });
});
