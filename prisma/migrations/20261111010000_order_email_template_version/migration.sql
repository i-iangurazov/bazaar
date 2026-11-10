-- Existing delivery attempts keep their original template and provider idempotency key.
-- Only newly queued deliveries opt into the shared branded template in application code.
SET lock_timeout = '5s';
ALTER TABLE "CustomerOrderEmailLog" ADD COLUMN "templateVersion" VARCHAR(32);
