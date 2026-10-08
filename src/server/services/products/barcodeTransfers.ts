import { Prisma } from "@prisma/client";

import { normalizeScanValue } from "@/lib/scanning/normalize";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { assertActorCanWriteProducts } from "@/server/services/productAccess";
import { assertBaamReviewedVersion } from "@/server/services/baamExecutionContext";

export type ProductBarcodeTransfer = { sourceProductId: string; barcode: string };

// Called inside the receiving product's save transaction. A failed save leaves
// every source barcode intact; restoring a source serializes on the same row.
export async function applyArchivedBarcodeTransfers(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    actorId: string;
    requestId: string;
    targetProductId: string;
    barcodes: string[];
    transfers?: ProductBarcodeTransfer[];
  },
) {
  if (!input.transfers?.length) return;
  const normalized = input.transfers.map((t) => ({
    ...t,
    barcode: normalizeScanValue(t.barcode),
  }));
  if (
    new Set(normalized.map((t) => t.barcode)).size !== normalized.length ||
    normalized.some(
      (t) => t.sourceProductId === input.targetProductId || !input.barcodes.includes(t.barcode),
    )
  ) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  const owned = await tx.productBarcode.findMany({
    where: {
      organizationId: input.organizationId,
      productId: input.targetProductId,
      value: { in: normalized.map((t) => t.barcode) },
    },
    select: { value: true },
  });
  const transfers = normalized.filter((t) => !owned.some((b) => b.value === t.barcode));
  if (!transfers.length) return;
  const sourceIds = [...new Set(transfers.map((t) => t.sourceProductId))].sort();
  const sources = await tx.$queryRaw<Array<{ id: string; isDeleted: boolean }>>(Prisma.sql`
    SELECT "id", "isDeleted" FROM "Product"
    WHERE "organizationId" = ${input.organizationId} AND "id" IN (${Prisma.join(sourceIds)})
    ORDER BY "id" FOR UPDATE
  `);
  await assertActorCanWriteProducts(tx, input.organizationId, input.actorId, sourceIds, {
    includeArchived: true,
    allowShared: true,
  });
  if (sources.length !== sourceIds.length || sources.some((p) => !p.isDeleted)) {
    throw new AppError("barcodeTransferUnavailable", "CONFLICT", 409);
  }
  for (const id of sourceIds) {
    await assertBaamReviewedVersion(tx, "Product", id);
    await tx.product.update({ where: { id }, data: { updatedAt: new Date() } });
  }
  for (const transfer of transfers) {
    const barcode = await tx.productBarcode.findFirst({
      where: {
        organizationId: input.organizationId,
        productId: transfer.sourceProductId,
        value: transfer.barcode,
      },
    });
    if (!barcode) throw new AppError("barcodeTransferUnavailable", "CONFLICT", 409);
    const removed = await tx.productBarcode.deleteMany({
      where: {
        id: barcode.id,
        organizationId: input.organizationId,
        productId: transfer.sourceProductId,
        value: transfer.barcode,
      },
    });
    if (removed.count !== 1) throw new AppError("barcodeTransferUnavailable", "CONFLICT", 409);
    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PRODUCT_BARCODE_TRANSFER",
      entity: "Product",
      entityId: transfer.sourceProductId,
      before: { barcode: transfer.barcode, productId: transfer.sourceProductId },
      after: { barcode: transfer.barcode, productId: input.targetProductId },
      requestId: input.requestId,
    });
  }
}
