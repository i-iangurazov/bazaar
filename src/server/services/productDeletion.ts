import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { AppError } from "./errors";

type Scope = { organizationId: string; actorId: string; productId: string };
const secret = () => {
  if (!process.env.NEXTAUTH_SECRET)
    throw new AppError("serviceUnavailable", "INTERNAL_SERVER_ERROR", 503);
  return process.env.NEXTAUTH_SECRET;
};
async function state(tx: Prisma.TransactionClient, scope: Scope) {
  const actor = await tx.user.findFirst({
    where: {
      id: scope.actorId,
      organizationId: scope.organizationId,
      isActive: true,
      role: "ADMIN",
    },
    select: { id: true },
  });
  if (!actor) throw new AppError("forbidden", "FORBIDDEN", 403);
  const product = await tx.product.findFirst({
    where: { id: scope.productId, organizationId: scope.organizationId },
    select: {
      id: true,
      name: true,
      sku: true,
      updatedAt: true,
      isDeleted: true,
      catalogMemberships: { select: { catalogId: true }, orderBy: { catalogId: "asc" } },
      assortmentGrants: { select: { ruleId: true }, orderBy: { ruleId: "asc" } },
      storeProducts: {
        select: {
          storeId: true,
          isActive: true,
          isHidden: true,
          updatedAt: true,
          store: { select: { name: true } },
        },
        orderBy: { storeId: "asc" },
      },
      _count: {
        select: {
          stockMovements: true,
          purchaseOrderLines: true,
          customerOrderLines: true,
          saleReturnLines: true,
          stockCounts: true,
          stockLots: true,
          bundleParents: true,
          priceBookEntries: true,
          priceBookItems: true,
        },
      },
    },
  });
  if (!product) throw new AppError("productNotFound", "NOT_FOUND", 404);
  const balances = await tx.inventorySnapshot.count({
    where: { productId: product.id, OR: [{ onHand: { not: 0 } }, { onOrder: { not: 0 } }] },
  });
  const reasons = Object.entries({ ...product._count, balances })
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ key, count }));
  return { product, reasons, canDelete: reasons.length === 0 };
}
const sign = (scope: Scope, value: Awaited<ReturnType<typeof state>>, expires: number) =>
  createHmac("sha256", secret())
    .update(
      JSON.stringify({
        scope: {
          organizationId: scope.organizationId,
          actorId: scope.actorId,
          productId: scope.productId,
        },
        value,
        expires,
      }),
    )
    .digest("hex");

export async function previewProductDeletion(scope: Scope) {
  return prisma.$transaction(
    async (tx) => {
      const value = await state(tx, scope),
        expires = Date.now() + 600_000;
      return {
        productId: value.product.id,
        productName: value.product.name,
        sku: value.product.sku,
        stores: value.product.storeProducts.map((s) => ({ id: s.storeId, name: s.store.name })),
        canDelete: value.canDelete,
        reasons: value.reasons,
        token: `${expires}.${sign(scope, value, expires)}`,
      };
    },
    { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 15_000 },
  );
}

/** Called under the product lock in the same transaction as the deletion. */
export async function assertProductDeletionReview(
  tx: Prisma.TransactionClient,
  scope: Scope,
  token: string,
) {
  const [rawExpiry, signature, extra] = token.split("."),
    expires = Number(rawExpiry);
  if (
    extra ||
    !Number.isSafeInteger(expires) ||
    expires < Date.now() ||
    !/^[a-f0-9]{64}$/.test(signature ?? "")
  )
    throw new AppError("productDeletionStale", "CONFLICT", 409);
  const value = await state(tx, scope),
    expected = sign(scope, value, expires);
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    throw new AppError("productDeletionStale", "CONFLICT", 409);
  if (!value.canDelete) throw new AppError("productDeleteBlockedByHistory", "CONFLICT", 409);
}
