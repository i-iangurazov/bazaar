import { prisma } from "@/server/db/prisma";
import { withIdempotency } from "./idempotency";
import { writeAuditLog } from "./audit";
import { AppError } from "./errors";

/** A unique-key claim waits for an in-flight transfer. If it has not claimed the
 * key yet, the terminal receipt prevents even a late original request posting. */
export async function reconcileTransferAttempt(input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  fromStoreId: string;
  toStoreId: string;
  idempotencyKey: string;
}) {
  return prisma.$transaction(
    async (tx) => {
      const storeIds = [...new Set([input.fromStoreId, input.toStoreId])];
      if (
        (await tx.store.count({
          where: { organizationId: input.organizationId, id: { in: storeIds } },
        })) !== storeIds.length
      )
        throw new AppError("storeNotFound", "NOT_FOUND", 404);
      const { result } = await withIdempotency<{
        fromStoreId: string;
        toStoreId: string;
        transferId?: string;
        canceled?: boolean;
      }>(
        tx,
        { key: input.idempotencyKey, route: "inventory.transfer", userId: input.actorId },
        async () => {
          await writeAuditLog(tx, {
            organizationId: input.organizationId,
            actorId: input.actorId,
            requestId: input.requestId,
            action: "TRANSFER_ATTEMPT_CANCELED",
            entity: "IdempotencyKey",
            entityId: input.idempotencyKey,
            before: null,
            after: { fromStoreId: input.fromStoreId, toStoreId: input.toStoreId, canceled: true },
          });
          return { fromStoreId: input.fromStoreId, toStoreId: input.toStoreId, canceled: true };
        },
      );
      if (result.fromStoreId !== input.fromStoreId || result.toStoreId !== input.toStoreId)
        throw new AppError("forbidden", "FORBIDDEN", 403);
      return result.transferId
        ? { status: "POSTED" as const, transferId: result.transferId }
        : { status: "CANCELED" as const, transferId: null };
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}
