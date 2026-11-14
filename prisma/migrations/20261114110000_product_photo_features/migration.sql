CREATE UNIQUE INDEX "Product_id_organizationId_key" ON "Product"("id", "organizationId");

CREATE TABLE "ProductPhotoFeature" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "sourceKey" VARCHAR(64) NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "embedding" REAL[] NOT NULL DEFAULT ARRAY[]::REAL[],
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "retryAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductPhotoFeature_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductPhotoFeature_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'READY', 'FAILED')),
  CONSTRAINT "ProductPhotoFeature_ready_dimension" CHECK ("status" <> 'READY' OR cardinality("embedding") = 512),
  CONSTRAINT "ProductPhotoFeature_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductPhotoFeature_productId_organizationId_fkey" FOREIGN KEY ("productId", "organizationId") REFERENCES "Product"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProductPhotoFeature_source_key" ON "ProductPhotoFeature"("organizationId", "productId", "sourceKey", "modelVersion");
CREATE INDEX "ProductPhotoFeature_modelVersion_status_retryAfter_idx" ON "ProductPhotoFeature"("modelVersion", "status", "retryAfter");
CREATE INDEX "ProductPhotoFeature_organizationId_productId_idx" ON "ProductPhotoFeature"("organizationId", "productId");
