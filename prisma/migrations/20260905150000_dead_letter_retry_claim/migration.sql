-- An unfinished claim is deliberately durable: uncertain work requires operator
-- reconciliation, not automatic replay after a lease or process timeout.
ALTER TABLE "DeadLetterJob"
ADD COLUMN "retryAttemptId" TEXT,
ADD COLUMN "retryStartedAt" TIMESTAMP(3);
