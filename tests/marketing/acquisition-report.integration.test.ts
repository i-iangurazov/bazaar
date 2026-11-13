import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { businessDateKey } from "@/lib/timezone";
import { resetDatabase, shouldRunDbTests } from "../helpers/db";

const reportSql = readFileSync(new URL("../../docs/marketing/instagram-2026-11/acquisition-cohort-report.sql", import.meta.url), "utf8");
// The manual-refund SQL guard checks the real PostgreSQL clock independently.
const referenceNow = new Date();
const cohortStart = new Date(referenceNow.getTime() - 3 * 86_400_000);
const cohortEnd = new Date(cohortStart.getTime() + 86_400_000);
const observedAt = new Date(referenceNow.getTime() - 3_600_000);
const at = (minutes: number) => new Date(cohortStart.getTime() + minutes * 60000);
const source = {
  utm_source: "instagram", utm_medium: "paid_social", utm_campaign: "synthetic_report",
  utm_content: "ad01_ru", capturedAt: cohortStart.toISOString(),
};
type Row = {
  source: string; medium: string; campaign: string; content: string;
  accounts_created: number; registered_businesses: number; businesses_with_products: number;
  businesses_with_stock_operations: number; businesses_with_completed_sales: number;
  confirmed_paying_businesses: number;
};
const report = (campaign = source.utm_campaign, observation = observedAt) =>
  prisma.$queryRawUnsafe<Row[]>(reportSql, cohortStart, cohortEnd, observation, campaign);

async function registeredBusiness(campaign = source.utm_campaign) {
  const org = await prisma.organization.create({ data: { name: "Synthetic report business", createdAt: at(2) } });
  const user = await prisma.user.create({ data: {
    organizationId: org.id, isOrgOwner: true, role: "ADMIN", name: "Synthetic owner",
    email: `${randomUUID()}@example.invalid`, passwordHash: "not-a-login-hash",
    signupAttribution: { ...source, utm_campaign: campaign }, createdAt: at(1),
  } });
  const store = await prisma.store.create({ data: {
    organizationId: org.id, name: "Synthetic store", code: "TEST", createdAt: at(2),
  } });
  return { org, user, store };
}

async function payment(fixture: Awaited<ReturnType<typeof registeredBusiness>>, options: { test?: boolean; verified?: boolean; goPay?: boolean } = {}) {
  const invoice = await prisma.subscriptionInvoice.create({ data: {
    organizationId: fixture.org.id, createdById: fixture.user.id,
    idempotencyKey: randomUUID(), plan: "STARTER", amountMinor: 200000,
    currency: "KGS", merchantId: "synthetic-report", isTest: options.test ?? false,
    ...(options.goPay ? { provider: "GOPAY", providerOrderId: randomUUID().replace(/-/g, "") } : {}),
    providerPaymentId: randomUUID(), status: "PAID", paidAt: at(6),
    termsVersion: "synthetic", termsUrl: "https://example.invalid/terms",
    sellerName: "Synthetic seller", expiresAt: observedAt,
    ...(options.verified ? { events: { create: {
      deduplicationKey: randomUUID(), state: "PAID", source: "CALLBACK",
      payloadDigest: "synthetic-no-provider-call", createdAt: at(6),
    } } } : {}),
  } });
  await prisma.subscriptionPeriod.create({ data: {
    organizationId: fixture.org.id, invoiceId: invoice.id, plan: "STARTER",
    startsAt: at(6), endsAt: new Date(referenceNow.getTime() + 30 * 86_400_000),
  } });
  return invoice;
}

const refund = (invoice: Awaited<ReturnType<typeof payment>>, amountMinor: number, createdAt: Date) => {
  const operation = randomUUID();
  return prisma.manualSubscriptionRefund.create({ data: {
    organizationId: invoice.organizationId, invoiceId: invoice.id, amountMinor,
    bankOperationId: operation, bankOperationKey: operation.toUpperCase(),
    bankTransferredOn: new Date(`${businessDateKey(at(7))}T00:00:00.000Z`),
    reason: "Synthetic bank transfer attestation for report regression only",
    idempotencyKey: randomUUID(), recordedById: invoice.createdById, createdAt,
  } });
};

(shouldRunDbTests ? describe : describe.skip)("persisted acquisition cohort outcomes in isolated database", () => {
  beforeEach(resetDatabase);

  it("separates accounts, businesses and real use; rejects trial, test and unverified payments", async () => {
    await registeredBusiness(); // An active trial alone is not activation or payment.
    const active = await registeredBusiness();
    await registeredBusiness("other_campaign");
    await prisma.user.create({ data: {
      role: "ADMIN", name: "Synthetic incomplete signup", email: `${randomUUID()}@example.invalid`,
      passwordHash: "not-a-login-hash", signupAttribution: source, createdAt: at(1),
    } });
    const unit = await prisma.unit.create({ data: {
      organizationId: active.org.id, code: "each", labelRu: "шт", labelKg: "даана",
    } });
    const product = await prisma.product.create({ data: {
      organizationId: active.org.id, sku: "SYNTHETIC", name: "Synthetic product",
      unit: "each", baseUnitId: unit.id, createdAt: at(3),
    } });
    await prisma.stockMovement.createMany({ data: [1, 2].map(() => ({
      storeId: active.store.id, productId: product.id, type: "RECEIVE" as const,
      qtyDelta: 1, createdAt: at(4),
    })) });
    await prisma.customerOrder.create({ data: {
      organizationId: active.org.id, storeId: active.store.id, number: "SYNTHETIC-1",
      isPosSale: true, status: "COMPLETED", completedAt: at(5),
    } });
    await payment(active, { test: true, verified: true });
    await payment(active, { verified: false });
    expect((await report())[0]).toEqual({
      source: "instagram", medium: "paid_social", campaign: "synthetic_report", content: "ad01_ru",
      accounts_created: 3, registered_businesses: 2, businesses_with_products: 1,
      businesses_with_stock_operations: 1, businesses_with_completed_sales: 1, confirmed_paying_businesses: 0,
    });
    await payment(active, { verified: true });
    await payment(active, { verified: true }); // Two renewals are one acquired business.
    expect((await report())[0].confirmed_paying_businesses).toBe(1);
    const row = (await report())[0];
    expect(JSON.stringify(row)).not.toMatch(/example\.invalid|Synthetic owner|organizationId|passwordHash/);
  });

  it("does not acquire an existing business again when another owner registers", async () => {
    const existing = await registeredBusiness("previous_campaign");
    await prisma.user.create({ data: {
      organizationId: existing.org.id, isOrgOwner: true, role: "ADMIN", name: "Synthetic second owner",
      email: `${randomUUID()}@example.invalid`, passwordHash: "not-a-login-hash",
      signupAttribution: source, createdAt: at(3),
    } });
    expect((await report())[0]).toMatchObject({ accounts_created: 1, registered_businesses: 0 });
    expect(await report("invalid campaign'; DROP TABLE User;")).toEqual([]);
    expect(await prisma.user.count()).toBe(2);
  });

  it.each([["partial", 50_000], ["full", 200_000]] as const)(
    "excludes an invoice with a known %s bank refund, then counts a different valid invoice once",
    async (_kind, amountMinor) => {
      const business = await registeredBusiness();
      const original = await payment(business, { verified: true, goPay: true });
      expect((await report())[0].confirmed_paying_businesses).toBe(1);
      await refund(original, amountMinor, new Date(observedAt.getTime() - 60_000));
      expect((await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: original.id } })).status).toBe("PAID");
      expect((await report())[0].confirmed_paying_businesses).toBe(0);
      await payment(business, { verified: true, goPay: true });
      await payment(business, { verified: true, goPay: true });
      expect((await report())[0]).toMatchObject({ registered_businesses: 1, confirmed_paying_businesses: 1 });
    },
  );

  it("does not let another organization's refund remove this cohort's valid payer", async () => {
    const business = await registeredBusiness();
    await payment(business, { verified: true, goPay: true });
    const other = await registeredBusiness("other_campaign");
    const otherInvoice = await payment(other, { verified: true, goPay: true });
    await refund(otherInvoice, otherInvoice.amountMinor, new Date(observedAt.getTime() - 60_000));
    expect((await report())[0]).toMatchObject({ accounts_created: 1, registered_businesses: 1, confirmed_paying_businesses: 1 });
  });

  it.each([["before", -1, 0], ["at", 0, 0], ["after", 1, 1]] as const)(
    "uses the recorded-at cutoff for a refund written %s observation, independently of bank transfer date",
    async (_position, offset, expectedPayers) => {
      const business = await registeredBusiness();
      const invoice = await payment(business, { verified: true, goPay: true });
      await refund(invoice, 50_000, new Date(observedAt.getTime() + offset));
      expect((await report())[0].confirmed_paying_businesses).toBe(expectedPayers);
      const inBishkekSession = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL TIME ZONE 'Asia/Bishkek'`;
        return tx.$queryRawUnsafe<Row[]>(reportSql, cohortStart, cohortEnd, observedAt, source.utm_campaign);
      });
      expect(inBishkekSession[0].confirmed_paying_businesses).toBe(expectedPayers);
      expect((await report(source.utm_campaign, referenceNow))[0].confirmed_paying_businesses).toBe(0);
    },
  );
});
