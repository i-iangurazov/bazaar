ALTER TABLE "User"
ADD COLUMN "isOrgOwner" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "DiagnosticsReport" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resultsJson" JSONB NOT NULL,

  CONSTRAINT "DiagnosticsReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DiagnosticsReport_organizationId_createdAt_idx"
  ON "DiagnosticsReport"("organizationId", "createdAt");

CREATE INDEX "DiagnosticsReport_createdById_createdAt_idx"
  ON "DiagnosticsReport"("createdById", "createdAt");

ALTER TABLE "DiagnosticsReport"
ADD CONSTRAINT "DiagnosticsReport_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DiagnosticsReport"
ADD CONSTRAINT "DiagnosticsReport_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
