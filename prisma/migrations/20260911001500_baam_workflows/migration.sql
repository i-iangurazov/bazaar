-- Additive BAAM workflow state; no business records or historical messages change.
ALTER TABLE "BaamConversation" ADD COLUMN "activeWorkflowId" TEXT;
ALTER TABLE "BaamAttachment" ADD COLUMN "contentHash" TEXT;
CREATE UNIQUE INDEX "BaamAttachment_conversationId_contentHash_key" ON "BaamAttachment"("conversationId", "contentHash");
CREATE TABLE "BaamWorkflow" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "turnId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "scopeRevision" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'EDITING',
  "parameters" JSONB NOT NULL,
  "presentation" JSONB NOT NULL,
  "result" JSONB,
  "resourceId" TEXT,
  "pendingRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BaamWorkflow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BaamWorkflow_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "BaamConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BaamWorkflow_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "BaamTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "BaamWorkflow_conversationId_status_createdAt_idx" ON "BaamWorkflow"("conversationId", "status", "createdAt");
CREATE TABLE "BaamWorkflowRequest" (
  "id" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "parameters" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "actionId" TEXT,
  "attemptToken" TEXT NOT NULL,
  "leaseUntil" TIMESTAMP(3) NOT NULL,
  "result" JSONB,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BaamWorkflowRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BaamWorkflowRequest_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "BaamWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "BaamWorkflowRequest_workflowId_createdAt_idx" ON "BaamWorkflowRequest"("workflowId", "createdAt");
