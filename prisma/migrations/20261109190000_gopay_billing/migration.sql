-- Additive: all historical payments retain FreedomPay identity and their terms.
CREATE TYPE "BillingPaymentProvider" AS ENUM ('FREEDOMPAY', 'GOPAY');
ALTER TABLE "SubscriptionInvoice" ADD COLUMN "provider" "BillingPaymentProvider" NOT NULL DEFAULT 'FREEDOMPAY', ADD COLUMN "providerOrderId" TEXT;
ALTER TABLE "WhatsAppInvoice" ADD COLUMN "provider" "BillingPaymentProvider" NOT NULL DEFAULT 'FREEDOMPAY', ADD COLUMN "providerOrderId" TEXT;
CREATE UNIQUE INDEX "SubscriptionInvoice_providerOrderId_key" ON "SubscriptionInvoice"("providerOrderId");
CREATE UNIQUE INDEX "WhatsAppInvoice_providerOrderId_key" ON "WhatsAppInvoice"("providerOrderId");
CREATE UNIQUE INDEX "SubscriptionInvoice_provider_payment_key" ON "SubscriptionInvoice"("provider", "merchantId", "isTest", "providerPaymentId");
CREATE UNIQUE INDEX "WhatsAppInvoice_provider_payment_key" ON "WhatsAppInvoice"("provider", "merchantId", "isTest", "providerPaymentId");
DROP INDEX "SubscriptionInvoice_merchantId_isTest_providerPaymentId_key";
DROP INDEX "WhatsAppInvoice_merchantId_isTest_providerPaymentId_key";
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_gopay_order" CHECK ("provider" <> 'GOPAY' OR ("providerOrderId" IS NOT NULL AND "providerOrderId" ~ '^[a-f0-9]{32}$'));
ALTER TABLE "WhatsAppInvoice" ADD CONSTRAINT "WhatsAppInvoice_gopay_order" CHECK ("provider" <> 'GOPAY' OR ("providerOrderId" IS NOT NULL AND "providerOrderId" ~ '^[a-f0-9]{32}$'));

-- Provider routing is part of the immutable financial snapshot for both products.
CREATE FUNCTION "protectBillingProviderIdentity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."provider", NEW."providerOrderId") IS DISTINCT FROM ROW(OLD."provider", OLD."providerOrderId") THEN
    RAISE EXCEPTION 'Payment provider identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SubscriptionInvoice_provider_guard" BEFORE UPDATE ON "SubscriptionInvoice"
  FOR EACH ROW EXECUTE FUNCTION "protectBillingProviderIdentity"();
CREATE TRIGGER "WhatsAppInvoice_provider_guard" BEFORE UPDATE ON "WhatsAppInvoice"
  FOR EACH ROW EXECUTE FUNCTION "protectBillingProviderIdentity"();
CREATE FUNCTION "protectWhatsAppInvoiceSnapshot"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."id", NEW."organizationId", NEW."createdById", NEW."idempotencyKey", NEW."quantity", NEW."amountMinor", NEW."currency", NEW."offerVersion", NEW."merchantId", NEW."isTest", NEW."termsVersion", NEW."termsUrl", NEW."termsAcceptedAt", NEW."expiresAt", NEW."createdAt")
    IS DISTINCT FROM
    ROW(OLD."id", OLD."organizationId", OLD."createdById", OLD."idempotencyKey", OLD."quantity", OLD."amountMinor", OLD."currency", OLD."offerVersion", OLD."merchantId", OLD."isTest", OLD."termsVersion", OLD."termsUrl", OLD."termsAcceptedAt", OLD."expiresAt", OLD."createdAt") THEN
    RAISE EXCEPTION 'WhatsApp invoice financial snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."providerPaymentId" IS NOT NULL AND NEW."providerPaymentId" IS DISTINCT FROM OLD."providerPaymentId" THEN
    RAISE EXCEPTION 'WhatsApp payment binding is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "WhatsAppInvoice_snapshot_guard" BEFORE UPDATE ON "WhatsAppInvoice"
  FOR EACH ROW EXECUTE FUNCTION "protectWhatsAppInvoiceSnapshot"();
