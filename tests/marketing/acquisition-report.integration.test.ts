import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { resetDatabase, shouldRunDbTests } from "../helpers/db";

const reportSql = readFileSync(new URL("../../docs/marketing/instagram-2026-11/acquisition-cohort-report.sql", import.meta.url), "utf8");
const cohortStart = new Date("2026-11-11T00:00:00+06:00");
const cohortEnd = new Date("2026-11-12T00:00:00+06:00");
const observedAt = new Date("2026-11-20T00:00:00+06:00");
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
const report = (campaign = source.utm_campaign) =>
  prisma.$queryRawUnsafe<Row[]>(reportSql, cohortStart, cohortEnd, observedAt, campaign);

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

async function payment(fixture: Awaited<ReturnType<typeof registeredBusiness>>, options: { test?: boolean; verified?: boolean } = {}) {
  const invoice = await prisma.subscriptionInvoice.create({ data: {
    organizationId: fixture.org.id, createdById: fixture.user.id,
    idempotencyKey: randomUUID(), plan: "STARTER", amountMinor: 200000,
    currency: "KGS", merchantId: "synthetic-report", isTest: options.test ?? false,
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
    startsAt: at(6), endsAt: new Date("2026-12-11T00:00:00+06:00"),
  } });
}

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
});
