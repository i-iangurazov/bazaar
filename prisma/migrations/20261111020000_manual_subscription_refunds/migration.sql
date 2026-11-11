-- Additive bank-transfer attestations for Bazaar's own SaaS subscriptions.
-- No provider refund, original invoice update, entitlement rollback, or backfill.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE "ManualSubscriptionRefund" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "bankOperationId" VARCHAR(120) NOT NULL,
    "bankOperationKey" VARCHAR(120) NOT NULL,
    "bankTransferredOn" DATE NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "recordedById" TEXT NOT NULL,
    "proofType" VARCHAR(32) NOT NULL DEFAULT 'OPERATOR_ATTESTATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManualSubscriptionRefund_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ManualSubscriptionRefund_amount_check" CHECK ("amountMinor" > 0),
    CONSTRAINT "ManualSubscriptionRefund_operation_check" CHECK (
      char_length(btrim("bankOperationId")) BETWEEN 3 AND 120
      AND "bankOperationId" !~ '[[:cntrl:]]'
      AND char_length("bankOperationKey") BETWEEN 3 AND 120
      AND "bankOperationKey" !~ '[[:space:]]'
    ),
    CONSTRAINT "ManualSubscriptionRefund_reason_check" CHECK (char_length(btrim("reason")) BETWEEN 10 AND 500),
    CONSTRAINT "ManualSubscriptionRefund_proof_check" CHECK ("proofType" = 'OPERATOR_ATTESTATION'),
    CONSTRAINT "ManualSubscriptionRefund_actor_check" CHECK (char_length(btrim("recordedById")) > 0),
    CONSTRAINT "ManualSubscriptionRefund_organizationId_fkey" FOREIGN KEY ("organizationId")
      REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "ManualSubscriptionRefund_invoiceId_organizationId_fkey" FOREIGN KEY ("invoiceId", "organizationId")
      REFERENCES "SubscriptionInvoice"("id", "organizationId") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "ManualSubscriptionRefund_bankOperationKey_key" ON "ManualSubscriptionRefund"("bankOperationKey");
CREATE UNIQUE INDEX "ManualSubscriptionRefund_idempotencyKey_key" ON "ManualSubscriptionRefund"("idempotencyKey");
CREATE INDEX "ManualSubscriptionRefund_invoiceId_createdAt_id_idx" ON "ManualSubscriptionRefund"("invoiceId", "createdAt", "id");
CREATE INDEX "ManualSubscriptionRefund_organizationId_createdAt_id_idx" ON "ManualSubscriptionRefund"("organizationId", "createdAt", "id");

CREATE FUNCTION "validateManualSubscriptionRefund"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  invoice "SubscriptionInvoice"%ROWTYPE;
  refunded BIGINT;
BEGIN
  -- After waiting for the organization lock, SUM must see the preceding commit.
  -- Fixed-snapshot isolation would not guarantee that; fail closed for raw writers.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Manual subscription refunds require READ COMMITTED isolation' USING ERRCODE = '23514';
  END IF;
  -- The same organization lock serializes grants and every partial refund.
  PERFORM id FROM "Organization" WHERE id = NEW."organizationId" FOR UPDATE;
  SELECT * INTO invoice FROM "SubscriptionInvoice" WHERE id = NEW."invoiceId";
  IF NOT FOUND OR invoice."organizationId" IS DISTINCT FROM NEW."organizationId" THEN
    -- Leave nonexistent/cross-organization references to the composite FK.
    RETURN NEW;
  END IF;
  IF NEW."organizationId" IN (
      'cmldyo7dn0005btviqlnua4ii', 'cmohj800e0005blb2bybx77dy',
      'cmoiyjd650005inhb5bku5bsv', 'cmp5ntkgg0005njbftimmsg32',
      'cmqayktaq003eomscrqp2p8wr'
    ) OR EXISTS (
      SELECT 1 FROM "SubscriptionContract"
      WHERE "organizationId" = NEW."organizationId" AND "lifetimeAccess"
    ) THEN
    RAISE EXCEPTION 'Lifetime organization is protected' USING ERRCODE = '23514';
  END IF;
  IF invoice.status <> 'PAID' OR invoice.provider <> 'GOPAY' OR invoice."isTest"
    OR invoice.currency <> 'KGS' OR invoice."paidAt" IS NULL
    OR invoice."paidAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    OR invoice."providerOrderId" IS NULL OR invoice."providerPaymentId" IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM "SubscriptionPaymentEvent" WHERE "invoiceId" = invoice.id
        AND state = 'PAID' AND source IN ('CALLBACK', 'RECONCILIATION')
    ) OR NOT EXISTS (
      SELECT 1 FROM "SubscriptionPeriod" WHERE "invoiceId" = invoice.id
        AND "organizationId" = NEW."organizationId"
    ) THEN
    RAISE EXCEPTION 'Manual refund requires a verified live GoPay subscription payment' USING ERRCODE = '23514';
  END IF;
  IF NEW."bankTransferredOn" < ((invoice."paidAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bishkek')::DATE
    OR NEW."bankTransferredOn" > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE THEN
    RAISE EXCEPTION 'Bank transfer date must be between payment and current Bishkek dates' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(SUM("amountMinor"), 0) INTO refunded FROM "ManualSubscriptionRefund" WHERE "invoiceId" = invoice.id;
  IF refunded + NEW."amountMinor" > invoice."amountMinor" THEN
    RAISE EXCEPTION 'Manual refunds exceed the original payment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ManualSubscriptionRefund_insert_guard" BEFORE INSERT ON "ManualSubscriptionRefund"
  FOR EACH ROW EXECUTE FUNCTION "validateManualSubscriptionRefund"();

CREATE FUNCTION "protectManualSubscriptionRefund"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Manual subscription refund records are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "ManualSubscriptionRefund_immutable_guard" BEFORE UPDATE OR DELETE ON "ManualSubscriptionRefund"
  FOR EACH ROW EXECUTE FUNCTION "protectManualSubscriptionRefund"();

-- Protect only this financial event; unrelated audit records retain their behavior.
CREATE FUNCTION "protectManualSubscriptionRefundAudit"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.action = 'SUBSCRIPTION_MANUAL_REFUND_RECORDED' OR OLD.entity = 'ManualSubscriptionRefund' THEN
    RAISE EXCEPTION 'Manual subscription refund audit records are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.action = 'SUBSCRIPTION_MANUAL_REFUND_RECORDED' OR NEW.entity = 'ManualSubscriptionRefund' THEN
      RAISE EXCEPTION 'Manual subscription refund audit records must be inserted' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "AuditLog_manual_subscription_refund_guard" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "protectManualSubscriptionRefundAudit"();

COMMIT;
