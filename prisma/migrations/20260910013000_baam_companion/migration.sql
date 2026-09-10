-- CreateTable
CREATE TABLE "BaamConversation" (
    "scopeStoreIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "storeId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "nextSequence" INTEGER NOT NULL DEFAULT 0,
    "activeTurnId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BaamConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaamMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "turnId" TEXT,
    "sequence" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "parts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BaamMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaamTurn" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "scopeRevision" INTEGER NOT NULL,
    "storeId" TEXT,
    "locale" TEXT NOT NULL,
    "pageContext" JSONB,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BaamTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaamAction" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "scopeRevision" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "attemptToken" TEXT,
    "result" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BaamAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaamExecution" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptToken" TEXT,
    "transactionId" TEXT,
    "receipts" JSONB,
    "output" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "BaamExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaamAttachment" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BaamAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaamTranscription" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "audioHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "text" TEXT,
    "languages" JSONB,
    "duration" DOUBLE PRECISION NOT NULL,
    "needsReview" BOOLEAN NOT NULL DEFAULT true,
    "usedTurnId" TEXT,
    "errorCode" TEXT,
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BaamTranscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BaamConversation_organizationId_userId_deletedAt_updatedAt__idx" ON "BaamConversation"("organizationId", "userId", "deletedAt", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "BaamMessage_turnId_idx" ON "BaamMessage"("turnId");

-- CreateIndex
CREATE UNIQUE INDEX "BaamMessage_conversationId_sequence_key" ON "BaamMessage"("conversationId", "sequence");

-- CreateIndex
CREATE INDEX "BaamTurn_status_leaseUntil_idx" ON "BaamTurn"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "BaamTurn_conversationId_clientRequestId_key" ON "BaamTurn"("conversationId", "clientRequestId");

-- CreateIndex
CREATE INDEX "BaamAction_conversationId_status_createdAt_idx" ON "BaamAction"("conversationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BaamAction_turnId_fingerprint_key" ON "BaamAction"("turnId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "BaamExecution_actionId_step_key" ON "BaamExecution"("actionId", "step");

-- CreateIndex
CREATE INDEX "BaamAttachment_conversationId_createdAt_idx" ON "BaamAttachment"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "BaamTranscription_expiresAt_idx" ON "BaamTranscription"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BaamTranscription_conversationId_audioHash_key" ON "BaamTranscription"("conversationId", "audioHash");

-- AddForeignKey
ALTER TABLE "BaamConversation" ADD CONSTRAINT "BaamConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaamConversation" ADD CONSTRAINT "BaamConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaamMessage" ADD CONSTRAINT "BaamMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "BaamConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaamMessage" ADD CONSTRAINT "BaamMessage_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "BaamTurn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaamTurn" ADD CONSTRAINT "BaamTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "BaamConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaamAction" ADD CONSTRAINT "BaamAction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "BaamConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaamAction" ADD CONSTRAINT "BaamAction_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "BaamTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaamExecution" ADD CONSTRAINT "BaamExecution_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "BaamAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaamAttachment" ADD CONSTRAINT "BaamAttachment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "BaamConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaamTranscription" ADD CONSTRAINT "BaamTranscription_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "BaamConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
