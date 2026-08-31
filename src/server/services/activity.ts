import type { AuditLog, Prisma, PrismaClient } from "@prisma/client";

export type ActivityActor = {
  name: string | null;
  email: string;
};

export type ActivityItem = {
  id: string;
  action: string;
  entity: string;
  createdAt: Date;
  actor: ActivityActor | null;
  summaryKey?: string;
  summaryValues?: Record<string, string | number>;
};

type AuditLogWithActor = AuditLog & { actor: ActivityActor | null };

const asRecord = (value: Prisma.JsonValue | null): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const extractSnapshotInfo = (log: AuditLogWithActor) => {
  const after = asRecord(log.after);
  const before = asRecord(log.before);
  const source = after ?? before;
  if (!source) {
    return null;
  }

  const productId = asString(source.productId);
  const storeId = asString(source.storeId);
  const onHand = asNumber(after?.onHand ?? source.onHand);
  const beforeOnHand = asNumber(before?.onHand);
  const qtyDelta = onHand !== undefined && beforeOnHand !== undefined ? onHand - beforeOnHand : undefined;

  return {
    productId,
    storeId,
    onHand,
    qtyDelta,
  };
};

const extractName = (log: AuditLogWithActor) => {
  const after = asRecord(log.after);
  const before = asRecord(log.before);
  return asString(after?.name ?? before?.name);
};

const extractEmail = (log: AuditLogWithActor) => {
  const after = asRecord(log.after);
  const before = asRecord(log.before);
  return asString(after?.email ?? before?.email);
};

const extractLocale = (log: AuditLogWithActor) => {
  const after = asRecord(log.after);
  const before = asRecord(log.before);
  return asString(after?.preferredLocale ?? before?.preferredLocale);
};

const extractAllowNegativeStock = (log: AuditLogWithActor) => {
  const after = asRecord(log.after);
  const before = asRecord(log.before);
  return asBoolean(after?.allowNegativeStock ?? before?.allowNegativeStock);
};

export const enrichRecentActivity = async (
  prisma: PrismaClient | Prisma.TransactionClient,
  logs: AuditLogWithActor[],
): Promise<ActivityItem[]> => {
  const snapshotInfo = new Map<string, ReturnType<typeof extractSnapshotInfo>>();
  const productIds = new Set<string>();
  const storeIds = new Set<string>();
  const purchaseOrderIds = new Set<string>();

  for (const log of logs) {
    if (log.entity === "InventorySnapshot") {
      const info = extractSnapshotInfo(log);
      snapshotInfo.set(log.id, info);
      if (info?.productId) {
        productIds.add(info.productId);
      }
      if (info?.storeId) {
        storeIds.add(info.storeId);
      }
    }
    if (log.entity === "PurchaseOrder") {
      purchaseOrderIds.add(log.entityId);
    }
  }

  const [products, stores, purchaseOrders] = await Promise.all([
    productIds.size
      ? prisma.product.findMany({
          where: { id: { in: Array.from(productIds) } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    storeIds.size
      ? prisma.store.findMany({
          where: { id: { in: Array.from(storeIds) } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    purchaseOrderIds.size
      ? prisma.purchaseOrder.findMany({
          where: { id: { in: Array.from(purchaseOrderIds) } },
          include: {
            supplier: { select: { name: true } },
            store: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const productMap = new Map(products.map((product) => [product.id, product.name]));
  const storeMap = new Map(stores.map((store) => [store.id, store.name]));
  const poMap = new Map(
    purchaseOrders.map((po) => [
      po.id,
      {
        supplierName: po.supplier?.name ?? "",
        storeName: po.store?.name ?? "",
        status: po.status,
      },
    ]),
  );

  return logs.map((log) => {
    let summaryKey: string | undefined;
    let summaryValues: Record<string, string | number> | undefined;

    switch (log.action) {
      case "INVENTORY_ADJUST": {
        const info = snapshotInfo.get(log.id);
        summaryKey = "summary.inventoryAdjust";
        summaryValues = {
          productName: info?.productId ? productMap.get(info.productId) ?? "" : "",
          storeName: info?.storeId ? storeMap.get(info.storeId) ?? "" : "",
          qtyDelta: info?.qtyDelta ?? 0,
          onHand: info?.onHand ?? 0,
        };
        break;
      }
      case "INVENTORY_RECEIVE": {
        const info = snapshotInfo.get(log.id);
        summaryKey = "summary.inventoryReceive";
        summaryValues = {
          productName: info?.productId ? productMap.get(info.productId) ?? "" : "",
          storeName: info?.storeId ? storeMap.get(info.storeId) ?? "" : "",
          qtyDelta: info?.qtyDelta ?? 0,
          onHand: info?.onHand ?? 0,
        };
        break;
      }
      case "INVENTORY_TRANSFER_OUT":
      case "INVENTORY_TRANSFER_IN": {
        const info = snapshotInfo.get(log.id);
        summaryKey =
          log.action === "INVENTORY_TRANSFER_OUT"
            ? "summary.inventoryTransferOut"
            : "summary.inventoryTransferIn";
        summaryValues = {
          productName: info?.productId ? productMap.get(info.productId) ?? "" : "",
          storeName: info?.storeId ? storeMap.get(info.storeId) ?? "" : "",
          qtyDelta: info?.qtyDelta ?? 0,
          onHand: info?.onHand ?? 0,
        };
        break;
      }
      case "INVENTORY_RECOMPUTE": {
        const info = snapshotInfo.get(log.id);
        summaryKey = "summary.inventoryRecompute";
        summaryValues = {
          productName: info?.productId ? productMap.get(info.productId) ?? "" : "",
          storeName: info?.storeId ? storeMap.get(info.storeId) ?? "" : "",
          onHand: info?.onHand ?? 0,
        };
        break;
      }
      case "PO_CREATE":
      case "PO_SUBMIT":
      case "PO_APPROVE":
      case "PO_RECEIVE": {
        const po = poMap.get(log.entityId);
        summaryKey =
          log.action === "PO_CREATE"
            ? "summary.poCreate"
            : log.action === "PO_SUBMIT"
              ? "summary.poSubmit"
              : log.action === "PO_APPROVE"
                ? "summary.poApprove"
                : "summary.poReceive";
        summaryValues = {
          supplierName: po?.supplierName ?? "",
          storeName: po?.storeName ?? "",
          status: po?.status ?? "",
        };
        break;
      }
      case "PRODUCT_CREATE":
      case "PRODUCT_UPDATE":
      case "PRODUCT_ARCHIVE": {
        summaryKey =
          log.action === "PRODUCT_CREATE"
            ? "summary.productCreate"
            : log.action === "PRODUCT_UPDATE"
              ? "summary.productUpdate"
              : "summary.productArchive";
        summaryValues = {
          productName: extractName(log) ?? "",
        };
        break;
      }
      case "SUPPLIER_CREATE":
      case "SUPPLIER_UPDATE": {
        summaryKey = log.action === "SUPPLIER_CREATE" ? "summary.supplierCreate" : "summary.supplierUpdate";
        summaryValues = {
          supplierName: extractName(log) ?? "",
        };
        break;
      }
      case "STORE_POLICY_UPDATE": {
        summaryKey = "summary.storePolicyUpdate";
        summaryValues = {
          storeName: extractName(log) ?? "",
          allowNegativeStock: String(extractAllowNegativeStock(log) ?? false),
        };
        break;
      }
      case "REORDER_POLICY_UPDATE": {
        summaryKey = "summary.reorderPolicyUpdate";
        summaryValues = {
          productName: extractName(log) ?? "",
        };
        break;
      }
      case "USER_CREATE": {
        summaryKey = "summary.userCreate";
        summaryValues = {
          userEmail: extractEmail(log) ?? "",
        };
        break;
      }
      case "USER_LOCALE_UPDATE": {
        summaryKey = "summary.userLocaleUpdate";
        summaryValues = {
          userEmail: extractEmail(log) ?? "",
          locale: extractLocale(log) ?? "",
        };
        break;
      }
      case "SEED": {
        summaryKey = "summary.seed";
        summaryValues = {};
        break;
      }
      default: {
        summaryKey = undefined;
        summaryValues = undefined;
      }
    }

    return {
      id: log.id,
      action: log.action,
      entity: log.entity,
      createdAt: log.createdAt,
      actor: log.actor ?? null,
      summaryKey,
      summaryValues,
    };
  });
};
