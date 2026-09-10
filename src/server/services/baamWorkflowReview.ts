import { prisma } from "@/server/db/prisma";
import type { BaamAccess } from "./baamConversations";
import type { WorkflowValues, WorkflowPresentation } from "@/lib/baam/workflows";

// Capture versions when an entity is selected, not only when the user eventually
// clicks Save. Domain services still own the actual locks, validation and writes.
export async function captureWorkflowReview(
  access: BaamAccess,
  kind: string,
  values: WorkflowValues,
  presentation: WorkflowPresentation,
) {
  const p = structuredClone(presentation),
    org = { organizationId: access.scope.organizationId },
    stores = { storeId: { in: access.scope.storeIds } };
  const refs: [string, string][] = [
    ["productId", "Product"],
    ["supplierId", "Supplier"],
    ["customerId", "Customer"],
    ["saleId", "CustomerOrder"],
    ["customerOrderId", "CustomerOrder"],
    ["purchaseOrderId", "PurchaseOrder"],
    ["saleReturnId", "SaleReturn"],
    ["stockCountId", "StockCount"],
  ];
  p.reviews = (p.reviews ?? []).filter((r) =>
    refs.some(([key, entity]) => entity === r.entity && values[key] === r.id),
  );
  for (const [key, entity] of refs) {
    const id = values[key];
    if (typeof id !== "string" || p.reviews.some((r) => r.entity === entity && r.id === id))
      continue;
    const select = { id: true, updatedAt: true };
    let record: { id: string; updatedAt: Date } | null = null;
    if (entity === "Product")
      record = await prisma.product.findFirst({
        where: {
          id,
          ...org,
          isDeleted: false,
          ...(access.scope.role !== "ADMIN" && !access.scope.isOrgOwner
            ? { storeProducts: { some: { ...stores, isActive: true } } }
            : {}),
        },
        select,
      });
    if (entity === "Supplier")
      record = await prisma.supplier.findFirst({ where: { id, ...org }, select });
    if (entity === "Customer")
      record = await prisma.customer.findFirst({
        where: { id, ...org, ...stores, deletedAt: null },
        select,
      });
    if (entity === "CustomerOrder")
      record = await prisma.customerOrder.findFirst({ where: { id, ...org, ...stores }, select });
    if (entity === "PurchaseOrder")
      record = await prisma.purchaseOrder.findFirst({ where: { id, ...org, ...stores }, select });
    if (entity === "SaleReturn")
      record = await prisma.saleReturn.findFirst({ where: { id, ...org, ...stores }, select });
    if (entity === "StockCount")
      record = await prisma.stockCount.findFirst({ where: { id, ...org, ...stores }, select });
    if (record)
      p.reviews.push({ entity, id: record.id, updatedAt: record.updatedAt.toISOString() });
  }
  if (
    kind === "stock_set" &&
    typeof values.storeId === "string" &&
    typeof values.productId === "string" &&
    access.scope.storeIds.includes(values.storeId) &&
    p.reviews.some((r) => r.entity === "Product" && r.id === values.productId)
  ) {
    const variantId = typeof values.variantId === "string" ? values.variantId : null;
    if (
      !p.stockReview ||
      p.stockReview.storeId !== values.storeId ||
      p.stockReview.productId !== values.productId ||
      p.stockReview.variantId !== variantId
    ) {
      const snapshot = await prisma.inventorySnapshot.findFirst({
        where: {
          storeId: values.storeId,
          productId: values.productId,
          variantKey: variantId ?? "BASE",
          store: org,
        },
        select: { version: true, onHand: true },
      });
      p.stockReview = {
        storeId: values.storeId,
        productId: values.productId,
        variantId,
        version: snapshot?.version ?? 0,
        onHand: snapshot?.onHand ?? 0,
      };
    }
  } else p.stockReview = undefined;
  return p;
}
