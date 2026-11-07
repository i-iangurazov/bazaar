CREATE TABLE "InitialProductImportSession" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "createdById" TEXT NOT NULL,
  "rowCounts" JSONB NOT NULL, "totalRows" INTEGER NOT NULL, "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InitialProductImportSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InitialProductImportSession_rows_check" CHECK ("totalRows" > 0 AND "totalRows" <= 2000 AND jsonb_typeof("rowCounts") = 'array'),
  CONSTRAINT "InitialProductImportSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InitialProductImportSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InitialProductImportSession_organizationId_key" ON "InitialProductImportSession"("organizationId");
CREATE TABLE "InitialProductImportChunk" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "chunkIndex" INTEGER NOT NULL,
  "payloadHash" TEXT NOT NULL, "rowCount" INTEGER NOT NULL, "batchId" TEXT NOT NULL,
  "summary" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InitialProductImportChunk_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InitialProductImportChunk_row_check" CHECK ("rowCount" > 0 AND "rowCount" <= 1000 AND "chunkIndex" >= 0),
  CONSTRAINT "InitialProductImportChunk_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InitialProductImportSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InitialProductImportChunk_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InitialProductImportChunk_sessionId_chunkIndex_key" ON "InitialProductImportChunk"("sessionId", "chunkIndex");
CREATE UNIQUE INDEX "InitialProductImportChunk_batchId_key" ON "InitialProductImportChunk"("batchId");
