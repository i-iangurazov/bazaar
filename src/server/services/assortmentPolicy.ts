import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { eventBus } from "@/server/events/eventBus";
import { getLogger } from "@/server/logging";

/** Call only after commit. Includes recipients granted by the database trigger. */
export async function publishAssortmentChange(organizationId: string) {
  try {
    const stores = await prisma.store.findMany({ where: { organizationId }, select: { id: true } });
    for (const store of stores)
      eventBus.publish({ type: "assortment.updated", payload: { storeId: store.id } });
  } catch {
    getLogger().warn({ organizationId }, "could not publish committed assortment change");
  }
}

/** Shared by group writers and directed configuration. Read the policy after locking. */
export async function lockAssortment(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  organizationId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assortment:${organizationId}`}, 0))`;
}

/** Materialized access has the same identity and uses the recipient's existing pricing.
 * No inventory, product fields or price records are written here. */
export async function grantAssortmentProducts(
  tx: Prisma.TransactionClient,
  rule: {
    id: string;
    organizationId: string;
    targetStoreId: string;
  },
  productIds: string[],
) {
  if (!productIds.length) return;
  await tx.storeProduct.createMany({
    data: productIds.map((productId) => ({
      organizationId: rule.organizationId,
      storeId: rule.targetStoreId,
      productId,
      isActive: true,
      isDirect: false,
      isHistorical: false,
    })),
    skipDuplicates: true,
  });
  await tx.storeProduct.updateMany({
    where: {
      organizationId: rule.organizationId,
      storeId: rule.targetStoreId,
      productId: { in: productIds },
      isActive: false,
    },
    data: { isActive: true },
  });
  await tx.assortmentGrant.createMany({
    data: productIds.map((productId) => ({ ruleId: rule.id, productId })),
    skipDuplicates: true,
  });
}
