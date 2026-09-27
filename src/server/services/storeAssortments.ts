import { eventBus } from "@/server/events/eventBus";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";
import { withIdempotency } from "@/server/services/idempotency";
import { grantAssortmentProducts, lockAssortment } from "@/server/services/assortmentPolicy";

const ids = z.array(z.string().min(1).max(100)).min(1).max(100);
export const assortmentChangeSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("SHARE"),
      sourceStoreId: z.string().min(1),
      targetStoreIds: ids,
      scope: z.enum(["ALL", "SELECTED"]),
      productIds: z.array(z.string().min(1)).max(20_000).default([]),
      includeFuture: z.boolean(),
      mutual: z.boolean().default(false),
      label: z.string().trim().max(120).optional(),
    })
    .strict(),
  z.object({ action: z.literal("PAUSE"), ruleIds: ids }).strict(),
  z.object({ action: z.literal("RESUME"), ruleIds: ids }).strict(),
  z.object({ action: z.literal("CONVERT"), storeIds: ids }).strict(),
]);
export type AssortmentChange = z.infer<typeof assortmentChangeSchema>;
type Tx = Prisma.TransactionClient;
const unique = (values: string[]) => [...new Set(values)].sort();
const storeSelect = {
  id: true,
  name: true,
  code: true,
  productCatalogId: true,
  directedAssortment: true,
  productCatalog: { select: { id: true, name: true } },
} satisfies Prisma.StoreSelect;
const activeProducts = { isActive: true, product: { isDeleted: false } };

export async function listStoreAssortmentOverview(input: { organizationId: string }) {
  return prisma.$transaction(
    async (tx) => {
      const stores = await tx.store.findMany({
        where: { organizationId: input.organizationId },
        select: storeSelect,
        orderBy: { name: "asc" },
      });
      const rules = await tx.assortmentRule.findMany({
        where: { organizationId: input.organizationId },
        orderBy: { id: "asc" },
      });
      const counts = await tx.$queryRaw<
        Array<{
          storeId: string;
          total: number;
          direct: number;
          historical: number;
          received: number;
        }>
      >`
      SELECT sp."storeId", count(*)::int AS total,
        count(*) FILTER (WHERE sp."isDirect")::int AS direct,
        count(*) FILTER (WHERE sp."isHistorical" AND NOT sp."isDirect")::int AS historical,
        count(*) FILTER (WHERE NOT sp."isHistorical" AND NOT sp."isDirect")::int AS received
      FROM "StoreProduct" sp JOIN "Product" p ON p.id = sp."productId"
      WHERE sp."organizationId" = ${input.organizationId} AND p."organizationId" = ${input.organizationId}
        AND sp."isActive" AND NOT p."isDeleted" GROUP BY sp."storeId"`;
      return {
        stores: stores.map((store) => {
          const count = counts.find((c) => c.storeId === store.id) ?? {
            total: 0,
            direct: 0,
            historical: 0,
            received: 0,
          };
          const incoming = rules.filter((r) => r.targetStoreId === store.id && r.active);
          const outgoing = rules.filter((r) => r.sourceStoreId === store.id && r.active);
          const peers =
            store.directedAssortment || !store.productCatalogId
              ? []
              : stores.filter(
                  (s) =>
                    s.id !== store.id &&
                    !s.directedAssortment &&
                    s.productCatalogId === store.productCatalogId,
                );
          return {
            ...store,
            counts: count,
            incoming,
            outgoing,
            legacyPeers: peers.map((s) => ({ id: s.id, name: s.name })),
            mode: peers.length
              ? "legacy"
              : incoming.length && outgoing.length
                ? "mutual"
                : incoming.length
                  ? "receiving"
                  : outgoing.length
                    ? "sharing"
                    : "independent",
          };
        }),
        rules,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function listAssortmentSourceProducts(input: {
  organizationId: string;
  storeId: string;
  search?: string;
  page: number;
}) {
  if (
    !(await prisma.store.findFirst({
      where: { id: input.storeId, organizationId: input.organizationId },
      select: { id: true },
    }))
  )
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  const where: Prisma.StoreProductWhereInput = {
    organizationId: input.organizationId,
    storeId: input.storeId,
    isActive: true,
    product: {
      organizationId: input.organizationId,
      isDeleted: false,
      ...(input.search
        ? {
            OR: [
              { name: { contains: input.search, mode: "insensitive" } },
              { sku: { contains: input.search, mode: "insensitive" } },
              { barcodes: { some: { value: { contains: input.search } } } },
            ],
          }
        : {}),
    },
  };
  const [items, total] = await prisma.$transaction([
    prisma.storeProduct.findMany({
      where,
      select: {
        isDirect: true,
        isHistorical: true,
        product: { select: { id: true, name: true, sku: true } },
      },
      orderBy: [{ product: { name: "asc" } }, { productId: "asc" }],
      skip: (input.page - 1) * 25,
      take: 25,
    }),
    prisma.storeProduct.count({ where }),
  ]);
  return { items, total, page: input.page, pageSize: 25 };
}

async function buildPreview(tx: Tx, organizationId: string, raw: AssortmentChange) {
  const change = assortmentChangeSchema.parse(raw);
  const rules = await tx.assortmentRule.findMany({
    where: { organizationId },
    orderBy: { id: "asc" },
  });
  const selectedRules =
    "ruleIds" in change ? rules.filter((r) => change.ruleIds.includes(r.id)) : [];
  if ("ruleIds" in change && selectedRules.length !== unique(change.ruleIds).length)
    throw new AppError("assortmentRuleNotFound", "NOT_FOUND", 404);
  if (
    change.action === "SHARE" &&
    (change.targetStoreIds.includes(change.sourceStoreId) ||
      (change.scope === "SELECTED" && (change.includeFuture || !change.productIds.length)))
  )
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  const storeIds =
    change.action === "SHARE"
      ? unique([change.sourceStoreId, ...change.targetStoreIds])
      : change.action === "CONVERT"
        ? unique(change.storeIds)
        : unique(selectedRules.flatMap((r) => [r.sourceStoreId, r.targetStoreId]));
  const stores = await tx.store.findMany({
    where: { organizationId, id: { in: storeIds } },
    select: storeSelect,
    orderBy: { id: "asc" },
  });
  if (stores.length !== storeIds.length) throw new AppError("storeNotFound", "NOT_FOUND", 404);
  const assignments = await tx.storeProduct.findMany({
    where: { organizationId, storeId: { in: storeIds }, ...activeProducts },
    select: {
      storeId: true,
      productId: true,
      isDirect: true,
      isHistorical: true,
      updatedAt: true,
      product: {
        select: {
          updatedAt: true,
          barcodes: { select: { value: true }, orderBy: { value: "asc" } },
          packs: { select: { packBarcode: true } },
        },
      },
    },
    orderBy: [{ storeId: "asc" }, { productId: "asc" }],
  });
  const storeRows = (id: string) => assignments.filter((a) => a.storeId === id);
  const sourceProducts = (id: string, scope: string, selection: string[]) => {
    const rows = storeRows(id);
    if (scope === "SELECTED") {
      if (unique(selection).some((p) => !rows.some((a) => a.productId === p)))
        throw new AppError("productAccessDenied", "FORBIDDEN", 403);
      return unique(selection);
    }
    return rows.filter((a) => a.isDirect).map((a) => a.productId);
  };
  const edges =
    change.action === "SHARE"
      ? unique(change.targetStoreIds).flatMap((targetStoreId) => [
          {
            sourceStoreId: change.sourceStoreId,
            targetStoreId,
            scope: change.scope,
            includeFuture: change.scope === "ALL" && change.includeFuture,
            selectedProductIds: sourceProducts(
              change.sourceStoreId,
              change.scope,
              change.productIds,
            ),
            label: change.label ?? null,
          },
          ...(change.mutual
            ? [
                {
                  sourceStoreId: targetStoreId,
                  targetStoreId: change.sourceStoreId,
                  scope: "ALL" as const,
                  includeFuture: change.includeFuture,
                  selectedProductIds: sourceProducts(targetStoreId, "ALL", []),
                  label: change.label ?? null,
                },
              ]
            : []),
        ])
      : change.action === "RESUME"
        ? selectedRules.map((r) => ({
            ...r,
            selectedProductIds:
              r.scope === "ALL" && r.includeFuture
                ? sourceProducts(r.sourceStoreId, "ALL", [])
                : r.selectedProductIds.filter((p) =>
                    storeRows(r.sourceStoreId).some((a) => a.productId === p),
                  ),
          }))
        : [];
  const convertIds =
    change.action === "CONVERT" ? storeIds : unique(edges.map((e) => e.targetStoreId));
  const legacyExits = stores.filter((s) => convertIds.includes(s.id) && !s.directedAssortment);
  const legacyPeers = await tx.store.findMany({
    where: {
      organizationId,
      directedAssortment: false,
      productCatalogId: {
        in: legacyExits.flatMap((s) => (s.productCatalogId ? [s.productCatalogId] : [])),
      },
      id: { notIn: convertIds },
    },
    select: storeSelect,
    orderBy: { id: "asc" },
  });
  const impactIds = unique([...convertIds, ...selectedRules.map((r) => r.targetStoreId)]);
  const impacts = impactIds.map((storeId) => {
    const store = stores.find((s) => s.id === storeId)!;
    const existing = storeRows(storeId);
    const granted = new Set(
      edges.filter((e) => e.targetStoreId === storeId).flatMap((e) => e.selectedProductIds),
    );
    const current = new Set(existing.map((a) => a.productId));
    const fresh = [...granted].filter((p) => !current.has(p));
    const barcodes = new Map<string, Set<string>>();
    for (const a of assignments.filter((a) => a.storeId === storeId || granted.has(a.productId))) {
      for (const value of [
        ...a.product.barcodes.map((b) => b.value),
        ...a.product.packs.flatMap((p) => (p.packBarcode ? [p.packBarcode] : [])),
      ]) {
        const productIds = barcodes.get(value) ?? new Set<string>();
        productIds.add(a.productId);
        barcodes.set(value, productIds);
      }
    }
    const conflicts = [...barcodes].filter(
      ([, p]) => p.size > 1 && [...p].some((id) => granted.has(id)),
    );
    return {
      storeId,
      storeName: store.name,
      currentTotal: current.size,
      newlyVisible: fresh.length,
      alreadyVisible: [...granted].filter((p) => current.has(p)).length,
      resultingTotal: current.size + fresh.length,
      retainedDirect: existing.filter((a) => a.isDirect).length,
      retainedHistorical: existing.filter((a) => a.isHistorical && !a.isDirect).length,
      retainedReceived: existing.filter((a) => !a.isDirect && !a.isHistorical).length,
      barcodeConflictCount: conflicts.length,
      barcodeConflicts: conflicts
        .slice(0, 20)
        .map(([barcode, productIds]) => ({ barcode, productIds: [...productIds].sort() })),
    };
  });
  const sourceReview = unique(edges.map((e) => e.sourceStoreId)).map((storeId) => {
    const rows = storeRows(storeId),
      selected = new Set(
        edges.filter((e) => e.sourceStoreId === storeId).flatMap((e) => e.selectedProductIds),
      );
    return {
      storeId,
      storeName: stores.find((s) => s.id === storeId)!.name,
      eligible: rows.filter((a) => a.isDirect).length,
      unresolved: rows.filter((a) => a.isHistorical && !a.isDirect).length,
      reviewedHistorical: rows.filter(
        (a) => selected.has(a.productId) && a.isHistorical && !a.isDirect,
      ).length,
      reviewedReceived: rows.filter(
        (a) => selected.has(a.productId) && !a.isHistorical && !a.isDirect,
      ).length,
    };
  });
  const affectedRules = rules.filter(
    (r) => storeIds.includes(r.sourceStoreId) || storeIds.includes(r.targetStoreId),
  );
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ change, stores, assignments, affectedRules, legacyPeers }))
    .digest("hex");
  return {
    change,
    fingerprint,
    edges,
    impacts,
    sourceReview,
    legacyExits: legacyExits.map((s) => ({
      id: s.id,
      name: s.name,
      group: s.productCatalog?.name ?? null,
      peers: legacyPeers
        .filter((p) => p.productCatalogId === s.productCatalogId)
        .map((p) => p.name),
    })),
    affectedRules,
    inventoryEffect: "NONE" as const,
    pricing: "EXISTING_STORE_PRICE_OR_GLOBAL_BASE" as const,
    retainedAccess: true,
    convertIds,
  };
}

function sign(value: string) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new AppError("unexpectedError", "INTERNAL_SERVER_ERROR", 500);
  return createHmac("sha256", secret).update(value).digest("hex");
}

async function applyTransaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 60_000,
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034" ||
        attempt >= 2
      )
        throw error;
      // A fresh snapshot after waiting on another writer must revalidate the preview.
    }
  }
}
export async function previewStoreAssortmentShare(input: {
  organizationId: string;
  actorId: string;
  change: AssortmentChange;
}) {
  const result = await prisma.$transaction(
    (tx) => buildPreview(tx, input.organizationId, input.change),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 },
  );
  const expiresAt = Date.now() + 15 * 60_000;
  const body = `${input.organizationId}:${input.actorId}:${expiresAt}:${result.fingerprint}`;
  // Product ID lists remain server-side; the UI shows distinct authoritative counts.
  const { edges, fingerprint, convertIds, ...preview } = result;
  void convertIds;
  return {
    ...preview,
    directions: edges.map(({ selectedProductIds, ...edge }) => ({
      ...edge,
      productCount: selectedProductIds.length,
    })),
    previewToken: `${expiresAt}.${fingerprint}.${sign(body)}`,
    expiresAt,
  };
}

export async function applyStoreAssortmentShare(input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  change: AssortmentChange;
  previewToken: string;
  idempotencyKey: string;
}) {
  const committed = await applyTransaction(async (tx) => {
    await lockAssortment(tx, input.organizationId);
    const replay = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "assortment.apply",
        userId: input.actorId,
        request: toJson({
          change: input.change,
          previewToken: input.previewToken,
        }) as Prisma.InputJsonValue,
      },
      async () => {
        const result = await buildPreview(tx, input.organizationId, input.change);
        const [expires, fingerprint, signature] = input.previewToken.split(".");
        const expected = sign(`${input.organizationId}:${input.actorId}:${expires}:${fingerprint}`);
        if (
          !signature ||
          signature.length !== expected.length ||
          !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ||
          Number(expires) < Date.now() ||
          fingerprint !== result.fingerprint
        )
          throw new AppError("assortmentPreviewStale", "CONFLICT", 409);
        await tx.store.updateMany({
          where: { organizationId: input.organizationId, id: { in: result.convertIds } },
          data: { directedAssortment: true, productCatalogId: null },
        });
        if (input.change.action === "PAUSE")
          await tx.assortmentRule.updateMany({
            where: { organizationId: input.organizationId, id: { in: input.change.ruleIds } },
            data: { active: false },
          });
        for (const edge of result.edges) {
          const rule = await tx.assortmentRule.upsert({
            where: {
              sourceStoreId_targetStoreId: {
                sourceStoreId: edge.sourceStoreId,
                targetStoreId: edge.targetStoreId,
              },
            },
            create: { organizationId: input.organizationId, ...edge, active: true },
            update: {
              scope: edge.scope,
              label: edge.label,
              includeFuture: edge.includeFuture,
              selectedProductIds: edge.selectedProductIds,
              active: true,
            },
          });
          await grantAssortmentProducts(tx, rule, edge.selectedProductIds);
        }
        const after = {
          change: result.change,
          impacts: result.impacts,
          legacyExits: result.legacyExits,
          directions: result.edges.map(({ selectedProductIds, ...edge }) => ({
            ...edge,
            productCount: selectedProductIds.length,
          })),
          inventoryEffect: result.inventoryEffect,
        };
        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          requestId: input.requestId,
          action: `ASSORTMENT_${input.change.action}`,
          entity: "StoreAssortment",
          entityId: input.organizationId,
          before: toJson({ rules: result.affectedRules, legacyExits: result.legacyExits }),
          after: toJson(after),
        });
        return after;
      },
    );
    return replay.result;
  });
  for (const impact of committed.impacts)
    eventBus.publish({ type: "assortment.updated", payload: { storeId: impact.storeId } });
  return committed;
}

export async function listAssortmentHistory(input: { organizationId: string; page: number }) {
  const where = { organizationId: input.organizationId, entity: "StoreAssortment" };
  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        action: true,
        createdAt: true,
        actor: { select: { name: true } },
        before: true,
        after: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (input.page - 1) * 20,
      take: 20,
    }),
    prisma.auditLog.count({ where }),
  ]);
  const edgeSchema = z.object({
    sourceStoreId: z.string(),
    targetStoreId: z.string(),
    includeFuture: z.boolean(),
    scope: z.string(),
    label: z.string().nullable().optional(),
  });
  const beforeSchema = z.object({ rules: z.array(edgeSchema.extend({ active: z.boolean() })) });
  const afterSchema = z.object({
    impacts: z.array(
      z.object({
        storeId: z.string(),
        storeName: z.string(),
        currentTotal: z.number(),
        newlyVisible: z.number(),
        alreadyVisible: z.number(),
        resultingTotal: z.number(),
      }),
    ),
    directions: z.array(edgeSchema.extend({ productCount: z.number() })),
    legacyExits: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        group: z.string().nullable(),
        peers: z.array(z.string()),
      }),
    ),
  });
  return {
    items: items.map(({ before, after, ...item }) => ({
      ...item,
      previousRules: beforeSchema.safeParse(before).data?.rules ?? [],
      impact: afterSchema.safeParse(after).data ?? null,
    })),
    total,
  };
}
