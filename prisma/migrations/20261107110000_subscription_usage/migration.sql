BEGIN;
CREATE TABLE "SubscriptionUsageBucket" (
 "id" TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL,
 "resource" TEXT NOT NULL,
 "startsAt" TIMESTAMP(3) NOT NULL,
 "endsAt" TIMESTAMP(3) NOT NULL,
 "used" INTEGER NOT NULL DEFAULT 0 CHECK ("used" >= 0),
 "reserved" INTEGER NOT NULL DEFAULT 0 CHECK ("reserved" >= 0),
 CONSTRAINT "SubscriptionUsageBucket_window_check" CHECK ("endsAt" > "startsAt"),
 CONSTRAINT "SubscriptionUsageBucket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SubscriptionUsageBucket_organizationId_resource_startsAt_key" ON "SubscriptionUsageBucket"("organizationId", "resource", "startsAt");
CREATE UNIQUE INDEX "SubscriptionUsageBucket_id_organizationId_key" ON "SubscriptionUsageBucket"("id", "organizationId");
CREATE TABLE "SubscriptionUsageReservation" (
 "id" TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL,
 "resource" TEXT NOT NULL,
 "operationKey" TEXT NOT NULL,
 "bucketId" TEXT NOT NULL,
 "units" INTEGER NOT NULL CHECK ("units" > 0),
 "state" TEXT NOT NULL DEFAULT 'RESERVED' CHECK ("state" IN ('RESERVED','COMMITTED','RELEASED')),
 "leaseToken" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "startedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "SubscriptionUsageReservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SubscriptionUsageReservation_bucketId_organizationId_fkey" FOREIGN KEY ("bucketId", "organizationId") REFERENCES "SubscriptionUsageBucket"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SubscriptionUsageReservation_organizationId_resource_operation_key" ON "SubscriptionUsageReservation"("organizationId", "resource", "operationKey");
CREATE INDEX "SubscriptionUsageReservation_state_expiresAt_idx" ON "SubscriptionUsageReservation"("state", "expiresAt");
COMMIT;
