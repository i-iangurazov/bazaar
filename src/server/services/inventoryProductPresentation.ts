import type { PrismaClient } from "@prisma/client";

import { inventoryProductImageUrl } from "@/lib/inventoryProductPresentation";
import { AppError } from "./errors";
import { decodeProductMovementDocumentKey, getProductMovementDocument } from "./productMovements";
import {
  assertUserCanAccessStore,
  inventoryProductAccessWhere,
  type StoreAccessUser,
} from "./storeAccess";

/** Read-only presentation data. No prices, quantities, assignments or stock writes. */
export async function getInventoryProductPresentation(
  db: PrismaClient,
  user: StoreAccessUser,
  input: { storeId: string; productIds: string[]; documentKey?: string },
) {
  await assertUserCanAccessStore(db, user, input.storeId);
  const productIds = [...new Set(input.productIds)];
  let historicalProductIds: string[] = [];
  if (input.documentKey) {
    const decoded = decodeProductMovementDocumentKey(input.documentKey);
    if (!decoded || !["TRANSFER", "STOCK_RECEIVING", "WRITE_OFF"].includes(decoded.documentType)) {
      throw new AppError("productMovementDocumentInvalid", "BAD_REQUEST", 400);
    }
    // Archived/disconnected cards remain readable only through an accessible
    // document that actually contains their exact IDs.
    const document = await getProductMovementDocument(db, user, input.documentKey);
    if (!document) throw new AppError("productMovementDocumentNotFound", "NOT_FOUND", 404);
    historicalProductIds = document.lines
      .filter((line) => productIds.includes(line.productId))
      .map((line) => line.productId);
  }
  const products = await db.product.findMany({
    where: {
      organizationId: user.organizationId,
      id: { in: productIds },
      OR: [
        { isDeleted: false, ...inventoryProductAccessWhere(input.storeId) },
        ...(historicalProductIds.length ? [{ id: { in: historicalProductIds } }] : []),
      ],
    },
    select: {
      id: true,
      sku: true,
      photoUrl: true,
      images: {
        where: { url: { not: { startsWith: "data:image/" } } },
        select: { url: true },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        take: 1,
      },
      barcodes: { select: { value: true }, take: 1 },
    },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  return productIds.map((productId) => {
    const product = byId.get(productId);
    return {
      productId,
      imageUrl: product ? inventoryProductImageUrl(product) : null,
      sku: product?.sku ?? "",
      barcode: product?.barcodes[0]?.value ?? null,
    };
  });
}
