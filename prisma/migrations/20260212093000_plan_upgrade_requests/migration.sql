-- CreateEnum
CREATE TYPE "PlanUpgradeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "PlanUpgradeRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "currentPlan" "OrganizationPlan" NOT NULL,
    "requestedPlan" "OrganizationPlan" NOT NULL,
    "status" "PlanUpgradeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,

    CONSTRAINT "PlanUpgradeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanUpgradeRequest_organizationId_status_createdAt_idx" ON "PlanUpgradeRequest"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PlanUpgradeRequest_status_createdAt_idx" ON "PlanUpgradeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PlanUpgradeRequest_requestedById_createdAt_idx" ON "PlanUpgradeRequest"("requestedById", "createdAt");

-- AddForeignKey
ALTER TABLE "PlanUpgradeRequest" ADD CONSTRAINT "PlanUpgradeRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanUpgradeRequest" ADD CONSTRAINT "PlanUpgradeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanUpgradeRequest" ADD CONSTRAINT "PlanUpgradeRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
