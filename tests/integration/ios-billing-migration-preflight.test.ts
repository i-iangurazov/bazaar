import { randomUUID } from "node:crypto";
import { Type } from "@apple/app-store-server-library";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createContractTerms } from "@/server/billing/contractTerms";
import { appleWhatsAppOffer } from "@/server/billing/appleOfferCatalog";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { assertSafeTestDatabaseReset } from "../helpers/testDatabaseSafety";
import { syntheticAppleTransaction } from "../helpers/appleSignedFixture";
import { parsePreflightTarget, runIosBillingPreflight } from "../../scripts/deployment/ios-billing-preflight";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const json = <T,>(value: T) => JSON.parse(JSON.stringify(value));
const audit = async () => {
  const { databaseUrl } = assertSafeTestDatabaseReset();
  const connection = new URL(databaseUrl);
  const args = ["--url-env", "EXPLICIT_OWNED_CI_AUDIT_URL", "--expect-host", connection.hostname, "--expect-port", connection.port || "5432",
    "--expect-database", decodeURIComponent(connection.pathname.slice(1)), "--expect-user", decodeURIComponent(connection.username), "--expect-stage", "POST_TEMPORARY_UPGRADES"];
  if (process.env.IOS_MIGRATION_PREFLIGHT_PSQL) args.push("--psql", process.env.IOS_MIGRATION_PREFLIGHT_PSQL);
  return runIosBillingPreflight(parsePreflightTarget(args, { EXPLICIT_OWNED_CI_AUDIT_URL: databaseUrl }));
};
const accountingSnapshot = async () => json({
  organizations: await prisma.organization.findMany({ orderBy: { id: "asc" } }),
  contracts: await prisma.subscriptionContract.findMany({ orderBy: { organizationId: "asc" } }),
  invoices: await prisma.subscriptionInvoice.findMany({ orderBy: { id: "asc" } }),
  periods: await prisma.subscriptionPeriod.findMany({ orderBy: { id: "asc" } }),
  whatsappInvoices: await prisma.whatsAppInvoice.findMany({ orderBy: { id: "asc" } }),
  lots: await prisma.whatsAppCreditLot.findMany({ orderBy: { id: "asc" } }),
});
const seedWebCredit = async () => {
  const f = await seedBase({ plan: "BUSINESS" });
  const invoice = await prisma.whatsAppInvoice.create({ data: { id: randomUUID(), organizationId: f.org.id, createdById: f.adminUser.id,
    idempotencyKey: randomUUID(), quantity: 1, amountMinor: 90000, offerVersion: "synthetic-preflight-web-v1", merchantId: "synthetic-only",
    provider: "GOPAY", providerOrderId: randomUUID().replaceAll("-", ""), providerPaymentId: randomUUID(),
    isTest: true, status: "PAID", paidAt: new Date(), expiresAt: new Date(Date.now() + 600_000),
    termsVersion: "synthetic-only", termsUrl: "https://synthetic.invalid/terms" } });
  const lot = await prisma.whatsAppCreditLot.create({ data: { invoiceId: invoice.id, organizationId: f.org.id, total: 1000,
    expiresAt: new Date(Date.now() + 365 * 86400000) } });
  return { ...f, lot };
};

describeDb("named Apple migration aggregate preflight on explicitly owned PostgreSQL", () => {
  beforeEach(resetDatabase);

  it("audits legacy, current and lifetime records without changing financial rows or disclosing identities", async () => {
    const f = await seedWebCredit();
    await prisma.subscriptionContract.create({ data: { organizationId: f.org.id, catalogVersion: "2026-10", termsSnapshot: createContractTerms("2026-10") } });
    const invoice = await prisma.subscriptionInvoice.create({ data: { organizationId: f.org.id, createdById: f.adminUser.id,
      idempotencyKey: randomUUID(), plan: "BUSINESS", amountMinor: 350000, merchantId: "synthetic-only", provider: "GOPAY",
      providerOrderId: randomUUID().replaceAll("-", ""), providerPaymentId: randomUUID(), isTest: true,
      status: "PAID", paidAt: new Date(), termsVersion: "synthetic-only", termsUrl: "https://synthetic.invalid/terms", sellerName: "SYNTHETIC",
      expiresAt: new Date(Date.now() + 600_000) } });
    await prisma.subscriptionPeriod.create({ data: { organizationId: f.org.id, invoiceId: invoice.id, plan: "BUSINESS",
      startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 31 * 86400000) } });
    const current = await prisma.organization.create({ data: { name: "Synthetic current contract" } });
    await prisma.subscriptionContract.create({ data: { organizationId: current.id, catalogVersion: "2026-11", termsSnapshot: createContractTerms("2026-11") } });
    const lifetime = await prisma.organization.create({ data: { name: "Synthetic protected lifetime" } });
    await prisma.subscriptionContract.create({ data: { organizationId: lifetime.id, catalogVersion: "2026-11", lifetimeAccess: true, termsSnapshot: createContractTerms("2026-11") } });
    const before = await accountingSnapshot();
    const result = await audit();
    expect(result).toMatchObject({ ok: true, schemaStage: "POST_TEMPORARY_UPGRADES", transactionReadOnly: true, blockerChecks: 0, skippedChecks: 0 });
    for (const name of ["legacy_contracts_total", "lifetime_contracts_preserved", "future_web_periods_preserved", "legacy_invoices_without_purchase_snapshot"])
      expect(result.checks.find((check) => check.name === name)?.count).toBe(1);
    expect(result.checks.find((check) => check.name === "current_contracts_total")?.count).toBe(2);
    for (const name of ["required_privacy_constraints_missing_or_unvalidated", "required_lifecycle_constraints_missing_or_unvalidated",
      "required_native_attempt_constraint_missing", "required_native_attempt_unique_index_missing", "native_attempt_without_authorization",
      "required_financial_privacy_triggers_missing_or_disabled", "required_apple_unique_indexes_missing_or_invalid", "reviewed_guard_function_bodies_changed",
      "temporary_upgrade_constraints_missing_or_unvalidated", "temporary_upgrade_indexes_missing_or_invalid", "temporary_upgrade_triggers_missing_or_disabled",
      "temporary_upgrade_function_bodies_changed", "temporary_upgrade_token_namespace_collisions", "temporary_upgrade_intent_shape_invalid",
      "temporary_upgrade_period_binding_invalid", "temporary_upgrade_standalone_period_invalid", "temporary_upgrade_dependency_state_invalid",
      "temporary_upgrade_ancestry_invalid", "temporary_upgrade_unserved_dependency_unreviewed"])
      expect(result.checks.find((check) => check.name === name)?.count).toBe(0);
    expect(await accountingSnapshot()).toEqual(before);
    for (const privateValue of [f.org.id, f.adminUser.id, f.adminUser.email, invoice.id, f.lot.id, "SYNTHETIC"])
      expect(JSON.stringify(result)).not.toContain(privateValue);
  });

  it("reports historically overdrawn credits as a count without rewriting or concealing the anomaly", async () => {
    const f = await seedWebCredit();
    await prisma.whatsAppCreditLot.update({ where: { id: f.lot.id }, data: { used: 1001 } });
    const result = await audit();
    expect(result).toMatchObject({ ok: true, blockerChecks: 0, warningChecks: 1 });
    expect(result.checks.find((check) => check.name === "whatsapp_credit_overdrawn")).toMatchObject({ severity: "warning", count: 1, skipped: false });
    expect((await prisma.whatsAppCreditLot.findUniqueOrThrow({ where: { id: f.lot.id } })).used).toBe(1001);
    expect(JSON.stringify(result)).not.toContain(f.lot.id);
  });

  it("blocks a manually seeded duplicate non-auto fulfillment while preserving each source record for investigation", async () => {
    const f = await seedBase({ plan: "BUSINESS" }), token = randomUUID(), offer = appleWhatsAppOffer(1), now = new Date();
    await prisma.appleBillingAccount.create({ data: { organizationId: f.org.id, appAccountToken: token } });
    const intent = await prisma.applePurchaseIntent.create({ data: { organizationId: f.org.id, createdById: f.adminUser.id,
      idempotencyKey: randomUUID(), scope: "WHATSAPP_PACK", productType: "CONSUMABLE", offerKey: offer.offerKey,
      productId: "synthetic.preflight.consumable", environment: "Sandbox", appAccountToken: token, offerSnapshot: json(offer),
      termsVersion: "synthetic-only", termsUrl: "https://synthetic.invalid/terms", status: "COMPLETED", authorizedAt: now, expiresAt: new Date(now.getTime() + 600_000) } });
    // Simulate an out-of-band legacy/manual write. Application confirmation has
    // its own single-fulfillment lock; this audit must independently detect drift.
    for (const transactionId of ["100000000007001", "100000000007002"]) {
      const transaction = await prisma.appleTransaction.create({ data: { organizationId: f.org.id, intentId: intent.id, transactionId,
        originalTransactionId: transactionId, environment: "Sandbox", appAccountToken: token, productId: intent.productId, productType: "CONSUMABLE",
        purchaseDate: now, priceMillis: 9990n, currency: "USD", offerSnapshot: json(offer), lastSignedAt: now, status: "GRANTED",
        signedTransactionInfo: syntheticAppleTransaction({ appAccountToken: token, productId: intent.productId, transactionId,
          originalTransactionId: transactionId, type: Type.CONSUMABLE, purchaseDate: now.getTime(), signedDate: now.getTime() }) } });
      await prisma.whatsAppCreditLot.create({ data: { organizationId: f.org.id, appleTransactionId: transaction.id, total: offer.messages, expiresAt: null } });
    }
    const result = await audit();
    expect(result).toMatchObject({ ok: false, blockerChecks: 1 });
    expect(result.checks.find((check) => check.name === "non_auto_intents_with_multiple_fulfillments")).toMatchObject({ count: 1, severity: "blocker" });
    expect(await prisma.appleTransaction.count()).toBe(2); expect(await prisma.whatsAppCreditLot.count()).toBe(2);
    expect(JSON.stringify(result)).not.toContain(intent.id);
  });
});
