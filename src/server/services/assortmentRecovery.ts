import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";

type Tx = Prisma.TransactionClient;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sorted = (ids: string[]) => [...new Set(ids)].sort();
const fail = (message: string): never => {
  throw new Error(`Assortment recovery stopped: ${message}`);
};
const previewSchema = z.object({
  sourceStore: z.object({
    id: z.string(),
    currentCatalogId: z.string(),
    currentCatalogName: z.string(),
  }),
  groupStoreImpacts: z.array(
    z.object({ storeId: z.string(), productsToAdd: z.number().int().nonnegative() }),
  ),
  totalProductsToAssign: z.number().int().positive(),
  totalSharedProductCount: z.number().int().nonnegative(),
  sourceProductCount: z.number().int().nonnegative(),
});

/** No stock-based ownership inference. This only reconstructs recorded access before one share. */
export async function planAssortmentRecovery(tx: Tx, organizationId: string, shareAuditId: string) {
  const audit = await tx.auditLog.findFirst({
    where: {
      id: shareAuditId,
      organizationId,
      action: "STORE_ASSORTMENT_SHARE",
      entity: "ProductCatalog",
    },
  });
  if (!audit) return fail("sharing audit was not found in this organization");
  const preview = previewSchema.parse(audit.before);
  if (preview.sourceStore.currentCatalogId !== audit.entityId)
    return fail("catalogue identity differs");
  const [stores, assignments, catalogs, subscriptions, rules] = await Promise.all([
    tx.store.findMany({
      where: { organizationId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        productCatalogId: true,
        directedAssortment: true,
        catalogSourcesConfigured: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    tx.storeProduct.findMany({
      where: { organizationId },
      orderBy: { id: "asc" },
      include: {
        product: { select: { organizationId: true, isDeleted: true, updatedAt: true } },
      },
    }),
    tx.productCatalog.findMany({
      where: { organizationId },
      orderBy: { id: "asc" },
      include: {
        products: { orderBy: { productId: "asc" }, select: { productId: true } },
      },
    }),
    tx.storeCatalog.findMany({ where: { store: { organizationId } } }),
    tx.assortmentRule.findMany({ where: { organizationId } }),
  ]);
  if (
    stores.some((s) => s.catalogSourcesConfigured || s.directedAssortment) ||
    subscriptions.length ||
    rules.length
  )
    return fail(
      "sources have already been configured; an automatic reconstruction would overwrite settings",
    );
  if (catalogs.some((c) => c.sourceKey || c.products.length))
    return fail("catalogue memberships have changed");
  if (assignments.some((a) => a.product.organizationId !== organizationId || a.isDirect))
    return fail("assignments include another organization or confirmed ownership");
  const affectedIds = sorted(preview.groupStoreImpacts.map((s) => s.storeId));
  const currentMembers = sorted(
    stores.filter((s) => s.productCatalogId === audit.entityId).map((s) => s.id),
  );
  if (JSON.stringify(affectedIds) !== JSON.stringify(currentMembers))
    return fail("group membership changed");
  const waves = new Map<number, typeof assignments>();
  for (const a of assignments) {
    const at = a.createdAt.getTime();
    if (
      at > audit.createdAt.getTime() ||
      at < audit.createdAt.getTime() - 60_000 ||
      !affectedIds.includes(a.storeId)
    )
      continue;
    const rows = waves.get(at) ?? [];
    rows.push(a);
    waves.set(at, rows);
  }
  const candidates = [...waves.entries()].filter(
    ([, rows]) =>
      rows.length === preview.totalProductsToAssign &&
      preview.groupStoreImpacts.every(
        (impact) =>
          rows.filter(
            (r) =>
              r.storeId === impact.storeId &&
              r.isActive &&
              !r.product.isDeleted &&
              r.assignedById === audit.actorId,
          ).length === impact.productsToAdd,
      ),
  );
  if (candidates.length !== 1)
    return fail("cannot identify exactly one assignment wave matching the sharing audit");
  const [boundaryMs, added] = candidates[0];
  if (
    assignments.some(
      (a) =>
        a.createdAt.getTime() > boundaryMs || a.updatedAt.getTime() > audit.createdAt.getTime(),
    )
  )
    return fail("assignments changed after the selected sharing operation");
  if (
    stores.some((s) => s.updatedAt > audit.createdAt) ||
    assignments.some((a) => a.product.updatedAt > audit.createdAt)
  )
    return fail("stores or products changed after the selected sharing operation");
  const addedIds = new Set(added.map((a) => a.id));
  const baselines = stores.map((s) => {
    const own = assignments.filter((a) => a.storeId === s.id);
    const previous = own.filter((a) => !addedIds.has(a.id) && a.isActive);
    const currentVisible = own.filter((a) => a.isActive && !a.product.isDeleted).length;
    const visible = previous.filter((a) => !a.product.isDeleted).length;
    return {
      storeId: s.id,
      name: s.name,
      currentVisible,
      visible,
      productIds: sorted(previous.map((a) => a.productId)),
      removedAssignmentIds: added
        .filter((a) => a.storeId === s.id)
        .map((a) => a.id)
        .sort(),
    };
  });
  if (
    baselines.some(
      (b) =>
        affectedIds.includes(b.storeId) && b.currentVisible !== preview.totalSharedProductCount,
    )
  )
    return fail("current visible sets differ from the recorded merge");
  const source = baselines.find((b) => b.storeId === preview.sourceStore.id);
  if (source?.visible !== preview.sourceProductCount)
    return fail("source count differs from the pre-sharing audit");
  const addedPairs = preview.groupStoreImpacts.map((i) => ({
    storeId: i.storeId,
    productId: { in: added.filter((a) => a.storeId === i.storeId).map((a) => a.productId) },
  }));
  const [stock, movement, document] = await Promise.all([
    tx.inventorySnapshot.findMany({ where: { OR: addedPairs }, orderBy: { id: "asc" } }),
    tx.stockMovement.findFirst({ where: { OR: addedPairs }, select: { id: true } }),
    tx.customerOrder.findFirst({
      where: {
        organizationId,
        OR: addedPairs.map((p) => ({
          storeId: p.storeId,
          lines: { some: { productId: p.productId } },
        })),
      },
      select: { id: true, number: true },
    }),
  ]);
  if (stock.some((s) => s.onHand !== 0 || s.onOrder !== 0) || movement || document)
    return fail(
      "newly shared positions have stock, movements or documents; manual review is required",
    );
  const snapshot = { audit, stores, assignments, catalogs, subscriptions, rules, stock };
  return {
    version: 1 as const,
    organizationId,
    shareAuditId,
    boundary: new Date(boundaryMs).toISOString(),
    fingerprint: digest(snapshot),
    catalogId: audit.entityId,
    previousCatalogName: preview.sourceStore.currentCatalogName,
    baselines,
    snapshot,
  };
}
export type AssortmentRecoveryPlan = Awaited<ReturnType<typeof planAssortmentRecovery>>;

/** Hash business records in PostgreSQL; no customer/product payload is exported. */
export async function recoveryBusinessDigest(tx: Tx, organizationId: string) {
  const tables: Array<[string, Prisma.Sql]> = [
    ["Product", Prisma.sql`SELECT p.* FROM "Product" p WHERE p."organizationId"=${organizationId}`],
    [
      "InventorySnapshot",
      Prisma.sql`SELECT p.* FROM "InventorySnapshot" p JOIN "Store" s ON s.id=p."storeId" WHERE s."organizationId"=${organizationId}`,
    ],
    [
      "StockMovement",
      Prisma.sql`SELECT p.* FROM "StockMovement" p JOIN "Store" s ON s.id=p."storeId" WHERE s."organizationId"=${organizationId}`,
    ],
    [
      "StorePrice",
      Prisma.sql`SELECT p.* FROM "StorePrice" p WHERE p."organizationId"=${organizationId}`,
    ],
    [
      "ProductCost",
      Prisma.sql`SELECT p.* FROM "ProductCost" p JOIN "Product" q ON q.id=p."productId" WHERE q."organizationId"=${organizationId}`,
    ],
    [
      "ProductBarcode",
      Prisma.sql`SELECT p.* FROM "ProductBarcode" p WHERE p."organizationId"=${organizationId}`,
    ],
    [
      "ProductVariant",
      Prisma.sql`SELECT p.* FROM "ProductVariant" p JOIN "Product" q ON q.id=p."productId" WHERE q."organizationId"=${organizationId}`,
    ],
    [
      "ProductPack",
      Prisma.sql`SELECT p.* FROM "ProductPack" p WHERE p."organizationId"=${organizationId}`,
    ],
    [
      "CustomerOrder",
      Prisma.sql`SELECT p.* FROM "CustomerOrder" p WHERE p."organizationId"=${organizationId}`,
    ],
    [
      "CustomerOrderLine",
      Prisma.sql`SELECT p.* FROM "CustomerOrderLine" p JOIN "CustomerOrder" q ON q.id=p."customerOrderId" WHERE q."organizationId"=${organizationId}`,
    ],
    [
      "Customer",
      Prisma.sql`SELECT p.* FROM "Customer" p WHERE p."organizationId"=${organizationId}`,
    ],
    [
      "SalePayment",
      Prisma.sql`SELECT p.* FROM "SalePayment" p WHERE p."organizationId"=${organizationId}`,
    ],
    [
      "SaleReturn",
      Prisma.sql`SELECT p.* FROM "SaleReturn" p WHERE p."organizationId"=${organizationId}`,
    ],
    [
      "PurchaseOrder",
      Prisma.sql`SELECT p.* FROM "PurchaseOrder" p WHERE p."organizationId"=${organizationId}`,
    ],
  ];
  const result: Record<string, { count: number; hash: string }> = {};
  for (const [name, rows] of tables) {
    const [r] = await tx.$queryRaw<Array<{ count: number; hash: string }>>(Prisma.sql`
      SELECT count(*)::int AS count, md5(COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text,'')) AS hash FROM (${rows}) p`);
    result[name] = r;
  }
  return result;
}

/** Explicit, versioned recovery only. The caller owns the transaction and a durable backup. */
export async function applyAssortmentRecovery(tx: Tx, plan: AssortmentRecoveryPlan) {
  const { organizationId, shareAuditId } = plan;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`assortment:${organizationId}`},0))`;
  const recovered = await tx.auditLog.findFirst({
    where: {
      organizationId,
      entity: "AssortmentRecovery",
      entityId: shareAuditId,
      action: "STORE_ASSORTMENT_RECOVER",
    },
  });
  if (recovered) {
    const after = recovered.after as { fingerprint?: string } | null;
    if (after?.fingerprint !== plan.fingerprint)
      return fail("recovery was already applied with another plan");
    return { replayed: true, auditId: recovered.id };
  }
  await tx.$queryRaw`SELECT id FROM "Store" WHERE "organizationId"=${organizationId} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "StoreProduct" WHERE "organizationId"=${organizationId} ORDER BY id FOR UPDATE`;
  const fresh = await planAssortmentRecovery(tx, organizationId, shareAuditId);
  if (fresh.fingerprint !== plan.fingerprint)
    return fail("preview is stale; inspect a new read-only plan");
  const before = await recoveryBusinessDigest(tx, organizationId);
  const requestId = `assortment-recovery:${shareAuditId}`;
  // Fixed baseline snapshots record prior access, not product ownership. They are
  // retained separately from received sources and from later confirmed local products.
  for (const baseline of fresh.baselines) {
    const catalog = await tx.productCatalog.create({
      data: {
        organizationId,
        name: baseline.name,
        sourceKey: `baseline:${baseline.storeId}`,
        sourceStoreId: baseline.storeId,
        includeFuture: false,
      },
    });
    await tx.productCatalogProduct.createMany({
      data: baseline.productIds.map((productId) => ({ catalogId: catalog.id, productId })),
    });
    await tx.storeCatalog.create({
      data: { storeId: baseline.storeId, catalogId: catalog.id, enabled: true, scope: "ALL" },
    });
  }
  await tx.store.updateMany({
    where: { organizationId },
    data: {
      productCatalogId: null,
      directedAssortment: true,
      catalogSourcesConfigured: true,
    },
  });
  const changed = await tx.storeProduct.updateMany({
    where: {
      organizationId,
      id: { in: fresh.baselines.flatMap((b) => b.removedAssignmentIds) },
    },
    data: { isActive: false, isHistorical: false },
  });
  if (changed.count !== fresh.baselines.reduce((n, b) => n + b.removedAssignmentIds.length, 0))
    return fail("unexpected assignment update count");
  await tx.productCatalog.update({
    where: { id: fresh.catalogId },
    data: { name: fresh.previousCatalogName },
  });
  const after = await recoveryBusinessDigest(tx, organizationId);
  if (digest(before) !== digest(after))
    return fail("business data changed; rolling back the entire recovery");
  const active = await tx.storeProduct.findMany({
    where: { organizationId, isActive: true },
    select: { storeId: true, productId: true },
  });
  for (const baseline of fresh.baselines) {
    if (
      JSON.stringify(
        sorted(active.filter((a) => a.storeId === baseline.storeId).map((a) => a.productId)),
      ) !== JSON.stringify(baseline.productIds)
    )
      return fail("restored product identities differ from the preview");
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: null,
        action: "CATALOG_BASELINE_RESTORE",
        entity: "StoreCatalogSettings",
        entityId: baseline.storeId,
        requestId,
        before: { sourceAuditId: shareAuditId, current: baseline.currentVisible },
        after: {
          baselineAt: fresh.boundary,
          baselineCount: baseline.visible,
          baselineHash: digest(baseline.productIds),
          settings: {
            connections: [
              { key: `baseline:${baseline.storeId}`, enabled: true, scope: "ALL", productIds: [] },
            ],
          },
          summary: { added: 0, hidden: baseline.currentVisible - baseline.visible },
        },
      },
    });
  }
  const audit = await tx.auditLog.create({
    data: {
      id: randomUUID(),
      organizationId,
      actorId: null,
      action: "STORE_ASSORTMENT_RECOVER",
      entity: "AssortmentRecovery",
      entityId: shareAuditId,
      requestId,
      before: JSON.parse(
        JSON.stringify({
          stores: fresh.snapshot.stores,
          affectedAssignments: fresh.snapshot.assignments.filter((a) =>
            fresh.baselines.some((b) => b.removedAssignmentIds.includes(a.id)),
          ),
        }),
      ),
      after: JSON.parse(
        JSON.stringify({
          fingerprint: fresh.fingerprint,
          boundary: fresh.boundary,
          baselines: fresh.baselines,
          businessDigests: after,
          requestedVia: "explicit operator recovery",
        }),
      ),
    },
  });
  return { replayed: false, auditId: audit.id, businessDigests: after };
}
