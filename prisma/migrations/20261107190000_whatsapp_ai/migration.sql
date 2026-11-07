-- CreateTable
CREATE TABLE "WhatsAppConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "providerAppId" TEXT,
    "providerAppName" TEXT,
    "phoneNumber" TEXT,
    "phoneNumberId" TEXT,
    "messagingAccountId" TEXT,
    "encryptedAppToken" TEXT,
    "encryptedWebhookKey" TEXT,
    "onboardingStateHash" TEXT,
    "onboardingExpiresAt" TIMESTAMP(3),
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "mode" TEXT NOT NULL DEFAULT 'STANDARD',
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "profile" JSONB NOT NULL,
    "knowledge" JSONB NOT NULL,
    "knowledgePublished" BOOLEAN NOT NULL DEFAULT false,
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "lastIssue" TEXT,
    "lastWebhookAt" TIMESTAMP(3),
    "lastProviderCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppConversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalIdentity" TEXT NOT NULL,
    "phone" TEXT,
    "bsuid" TEXT,
    "buyerCountry" TEXT,
    "customerName" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'AI',
    "needsHuman" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "generationVersion" INTEGER NOT NULL DEFAULT 1,
    "inboundSequence" INTEGER NOT NULL DEFAULT 0,
    "lastInboundAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastIssue" TEXT,
    "redactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "providerMessageId" TEXT,
    "providerEventKey" TEXT NOT NULL,
    "responseToId" TEXT,
    "media" JSONB,
    "facts" JSONB,
    "state" TEXT NOT NULL DEFAULT 'RECEIVED',
    "inboundSequence" INTEGER,
    "generationVersion" INTEGER,
    "configVersion" INTEGER,
    "actorId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "sendStartedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastIssue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppReadCursor" (
    "conversationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inboundSequence" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppReadCursor_pkey" PRIMARY KEY ("conversationId","userId")
);

-- CreateTable
CREATE TABLE "WhatsAppEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "providerStatus" TEXT,
    "opaqueMessageId" TEXT,
    "providerAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMonth" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "includedUsed" INTEGER NOT NULL DEFAULT 0,
    "includedReserved" INTEGER NOT NULL DEFAULT 0,
    "inboundCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "aiInputTokens" INTEGER NOT NULL DEFAULT 0,
    "aiOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedSpendMicros" BIGINT NOT NULL DEFAULT 0,
    "aiReservedMicros" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppCreditLot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppCreditLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppCreditUse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "monthId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "lotId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppCreditUse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "pendingSlot" TEXT,
    "quantity" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "offerVersion" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KGS',
    "status" TEXT NOT NULL DEFAULT 'CREATING',
    "merchantId" TEXT NOT NULL,
    "isTest" BOOLEAN NOT NULL,
    "providerPaymentId" TEXT,
    "checkoutUrl" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingToken" TEXT,
    "processingUntil" TIMESTAMP(3),
    "termsVersion" TEXT NOT NULL,
    "termsUrl" TEXT NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastIssue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppPaymentEvent" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppPaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppWorkerState" (
    "id" TEXT NOT NULL,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL,
    "dailyPeriod" TEXT NOT NULL,
    "spentMicros" BIGINT NOT NULL DEFAULT 0,
    "reservedMicros" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppWorkerState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_providerAppId_key" ON "WhatsAppConnection"("providerAppId");

-- CreateIndex
CREATE INDEX "WhatsAppConnection_state_aiEnabled_idx" ON "WhatsAppConnection"("state", "aiEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_organizationId_storeId_key" ON "WhatsAppConnection"("organizationId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_id_organizationId_storeId_key" ON "WhatsAppConnection"("id", "organizationId", "storeId");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_organizationId_storeId_archived_lastMe_idx" ON "WhatsAppConversation"("organizationId", "storeId", "archived", "lastMessageAt");

-- CreateIndex
CREATE INDEX "WhatsAppConversation_organizationId_needsHuman_lastMessageA_idx" ON "WhatsAppConversation"("organizationId", "needsHuman", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConversation_connectionId_externalIdentity_key" ON "WhatsAppConversation"("connectionId", "externalIdentity");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConversation_id_organizationId_storeId_key" ON "WhatsAppConversation"("id", "organizationId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_providerEventKey_key" ON "WhatsAppMessage"("providerEventKey");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_responseToId_key" ON "WhatsAppMessage"("responseToId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_direction_state_nextAttemptAt_leaseUntil_idx" ON "WhatsAppMessage"("direction", "state", "nextAttemptAt", "leaseUntil");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_conversationId_createdAt_id_idx" ON "WhatsAppMessage"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_id_organizationId_key" ON "WhatsAppMessage"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_conversationId_providerMessageId_direction_key" ON "WhatsAppMessage"("conversationId", "providerMessageId", "direction");

-- CreateIndex
CREATE INDEX "WhatsAppReadCursor_organizationId_userId_idx" ON "WhatsAppReadCursor"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppEvent_eventKey_key" ON "WhatsAppEvent"("eventKey");

-- CreateIndex
CREATE INDEX "WhatsAppEvent_connectionId_createdAt_idx" ON "WhatsAppEvent"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppEvent_eventType_processedAt_idx" ON "WhatsAppEvent"("eventType", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMonth_organizationId_period_key" ON "WhatsAppMonth"("organizationId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMonth_id_organizationId_key" ON "WhatsAppMonth"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppCreditLot_invoiceId_key" ON "WhatsAppCreditLot"("invoiceId");

-- CreateIndex
CREATE INDEX "WhatsAppCreditLot_organizationId_revoked_expiresAt_createdA_idx" ON "WhatsAppCreditLot"("organizationId", "revoked", "expiresAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppCreditLot_id_organizationId_key" ON "WhatsAppCreditLot"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppCreditLot_invoiceId_organizationId_key" ON "WhatsAppCreditLot"("invoiceId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppCreditUse_messageId_key" ON "WhatsAppCreditUse"("messageId");

-- CreateIndex
CREATE INDEX "WhatsAppCreditUse_organizationId_state_idx" ON "WhatsAppCreditUse"("organizationId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppCreditUse_messageId_organizationId_key" ON "WhatsAppCreditUse"("messageId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppInvoice_pendingSlot_key" ON "WhatsAppInvoice"("pendingSlot");

-- CreateIndex
CREATE INDEX "WhatsAppInvoice_status_nextCheckAt_idx" ON "WhatsAppInvoice"("status", "nextCheckAt");

-- CreateIndex
CREATE INDEX "WhatsAppInvoice_organizationId_createdAt_idx" ON "WhatsAppInvoice"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppInvoice_organizationId_idempotencyKey_key" ON "WhatsAppInvoice"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppInvoice_id_organizationId_key" ON "WhatsAppInvoice"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppInvoice_merchantId_isTest_providerPaymentId_key" ON "WhatsAppInvoice"("merchantId", "isTest", "providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppPaymentEvent_eventKey_key" ON "WhatsAppPaymentEvent"("eventKey");

-- CreateIndex
CREATE INDEX "WhatsAppPaymentEvent_invoiceId_createdAt_idx" ON "WhatsAppPaymentEvent"("invoiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Store_id_organizationId_key" ON "Store"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "WhatsAppConnection" ADD CONSTRAINT "WhatsAppConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConnection" ADD CONSTRAINT "WhatsAppConnection_storeId_organizationId_fkey" FOREIGN KEY ("storeId", "organizationId") REFERENCES "Store"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_connectionId_organizationId_storeId_fkey" FOREIGN KEY ("connectionId", "organizationId", "storeId") REFERENCES "WhatsAppConnection"("id", "organizationId", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_conversationId_organizationId_storeId_fkey" FOREIGN KEY ("conversationId", "organizationId", "storeId") REFERENCES "WhatsAppConversation"("id", "organizationId", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppReadCursor" ADD CONSTRAINT "WhatsAppReadCursor_conversationId_organizationId_storeId_fkey" FOREIGN KEY ("conversationId", "organizationId", "storeId") REFERENCES "WhatsAppConversation"("id", "organizationId", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppEvent" ADD CONSTRAINT "WhatsAppEvent_connectionId_organizationId_storeId_fkey" FOREIGN KEY ("connectionId", "organizationId", "storeId") REFERENCES "WhatsAppConnection"("id", "organizationId", "storeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMonth" ADD CONSTRAINT "WhatsAppMonth_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCreditLot" ADD CONSTRAINT "WhatsAppCreditLot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCreditLot" ADD CONSTRAINT "WhatsAppCreditLot_invoiceId_organizationId_fkey" FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "WhatsAppInvoice"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCreditUse" ADD CONSTRAINT "WhatsAppCreditUse_monthId_organizationId_fkey" FOREIGN KEY ("monthId", "organizationId") REFERENCES "WhatsAppMonth"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCreditUse" ADD CONSTRAINT "WhatsAppCreditUse_messageId_organizationId_fkey" FOREIGN KEY ("messageId", "organizationId") REFERENCES "WhatsAppMessage"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCreditUse" ADD CONSTRAINT "WhatsAppCreditUse_lotId_organizationId_fkey" FOREIGN KEY ("lotId", "organizationId") REFERENCES "WhatsAppCreditLot"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppInvoice" ADD CONSTRAINT "WhatsAppInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppPaymentEvent" ADD CONSTRAINT "WhatsAppPaymentEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "WhatsAppInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Counters cannot become negative under retries/concurrent workers. Late delivery
-- may legitimately exceed an earlier released capacity, so no upper bound on used.
ALTER TABLE "WhatsAppMonth" ADD CONSTRAINT "WhatsAppMonth_nonnegative" CHECK (
 "includedUsed" >= 0 AND "includedReserved" >= 0 AND "inboundCount" >= 0 AND "deliveredCount" >= 0
 AND "aiInputTokens" >= 0 AND "aiOutputTokens" >= 0 AND "estimatedSpendMicros" >= 0 AND "aiReservedMicros" >= 0);
ALTER TABLE "WhatsAppCreditLot" ADD CONSTRAINT "WhatsAppCreditLot_nonnegative" CHECK (total > 0 AND used >= 0 AND reserved >= 0);
ALTER TABLE "WhatsAppCreditUse" ADD CONSTRAINT "WhatsAppCreditUse_state" CHECK (state IN ('RESERVED', 'USED', 'RELEASED'));
ALTER TABLE "WhatsAppInvoice" ADD CONSTRAINT "WhatsAppInvoice_valid" CHECK (
 quantity BETWEEN 1 AND 10 AND "amountMinor" > 0 AND currency = 'KGS'
 AND ("pendingSlot" IS NULL OR "pendingSlot" = "organizationId")
 AND status IN ('CREATING', 'PENDING', 'PAID', 'FAILED', 'REVIEW'));
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_direction" CHECK (direction IN ('INBOUND', 'OUTBOUND', 'STAFF_APP'));
ALTER TABLE "WhatsAppConversation" ADD CONSTRAINT "WhatsAppConversation_mode" CHECK (mode IN ('AI', 'HUMAN') AND "inboundSequence" >= 0);
