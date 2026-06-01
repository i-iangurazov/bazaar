-- CreateEnum
CREATE TYPE "CustomerOrderEmailType" AS ENUM ('CONFIRMATION', 'TRACKING', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "CustomerOrderEmailStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "CustomerOrder"
ADD COLUMN "confirmationEmailSentAt" TIMESTAMP(3),
ADD COLUMN "trackingNumber" TEXT,
ADD COLUMN "trackingCarrier" TEXT,
ADD COLUMN "trackingUrl" TEXT,
ADD COLUMN "trackingStatus" TEXT,
ADD COLUMN "trackingAddedAt" TIMESTAMP(3),
ADD COLUMN "trackingEmailSentAt" TIMESTAMP(3),
ADD COLUMN "followUpEmailSentAt" TIMESTAMP(3);

CREATE INDEX "CustomerOrder_followUpEmailSentAt_completedAt_createdAt_idx" ON "CustomerOrder"("followUpEmailSentAt", "completedAt", "createdAt");

CREATE INDEX "CustomerOrder_trackingEmailSentAt_trackingAddedAt_idx" ON "CustomerOrder"("trackingEmailSentAt", "trackingAddedAt");

-- CreateTable
CREATE TABLE "CustomerOrderEmailLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerOrderId" TEXT NOT NULL,
    "type" "CustomerOrderEmailType" NOT NULL,
    "status" "CustomerOrderEmailStatus" NOT NULL,
    "recipientEmail" TEXT,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "triggeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerOrderEmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerOrderEmailLog_organizationId_storeId_createdAt_idx" ON "CustomerOrderEmailLog"("organizationId", "storeId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerOrderEmailLog_customerOrderId_createdAt_idx" ON "CustomerOrderEmailLog"("customerOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerOrderEmailLog_type_status_createdAt_idx" ON "CustomerOrderEmailLog"("type", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerOrderEmailLog_providerMessageId_idx" ON "CustomerOrderEmailLog"("providerMessageId");

-- AddForeignKey
ALTER TABLE "CustomerOrderEmailLog" ADD CONSTRAINT "CustomerOrderEmailLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrderEmailLog" ADD CONSTRAINT "CustomerOrderEmailLog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrderEmailLog" ADD CONSTRAINT "CustomerOrderEmailLog_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "CustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrderEmailLog" ADD CONSTRAINT "CustomerOrderEmailLog_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
