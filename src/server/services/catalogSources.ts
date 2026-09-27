import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { AppError } from "./errors";
import { lockAssortment, publishAssortmentChange } from "./assortmentPolicy";
import { withIdempotency } from "./idempotency";
import { writeAuditLog } from "./audit";
import { toJson } from "./json";

type Tx = Prisma.TransactionClient;
const unique = (ids: string[]) => [...new Set(ids)].sort();
export const catalogSettingsSchema = z
  .object({
    storeId: z.string().min(1),
    connections: z
      .array(
        z
          .object({
            key: z.string().min(1).max(200),
            enabled: z.boolean(),
            scope: z.enum(["ALL", "SELECTED"]),
            productIds: z.array(z.string().min(1)).max(20_000).default([]),
          })
          .strict(),
      )
      .max(100),
    confirmProductIds: z.array(z.string().min(1)).max(20_000).default([]),
  })
  .strict();
export type CatalogSettings = z.infer<typeof catalogSettingsSchema>;
type Source = {
  key: string;
  catalogId: string | null;
  name: string;
  sourceStoreId: string | null;
  sourceName: string | null;
  includeFuture: boolean;
  productIds: string[];
  memberIds: string[];
  shared: boolean;
};

/** Read-only compatibility projection. Never infers ownership from stock or group membership. */
async function graph(tx: Tx, organizationId: string) {
  const [stores, allAssignments, catalogs, rules, subscriptions] = await Promise.all([
    tx.store.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        code: true,
        productCatalogId: true,
        directedAssortment: true,
        catalogSourcesConfigured: true,
        updatedAt: true,
      },
      orderBy: { name: "asc" },
    }),
    tx.storeProduct.findMany({
      where: { organizationId, product: { organizationId } },
      select: {
        storeId: true,
        productId: true,
        product: { select: { isDeleted: true } },
        isActive: true,
        isDirect: true,
        isHistorical: true,
        updatedAt: true,
      },
      orderBy: [{ storeId: "asc" }, { productId: "asc" }],
    }),
    tx.productCatalog.findMany({
      where: { organizationId },
      include: {
        products: {
          where: { product: { organizationId } },
          select: { productId: true, product: { select: { isDeleted: true } } },
          orderBy: { productId: "asc" },
        },
      },
      orderBy: { id: "asc" },
    }),
    tx.assortmentRule.findMany({
      where: { organizationId },
      include: {
        grants: {
          where: { product: { organizationId } },
          select: { productId: true, product: { select: { isDeleted: true } } },
          orderBy: { productId: "asc" },
        },
      },
      orderBy: { id: "asc" },
    }),
    tx.storeCatalog.findMany({
      where: { store: { organizationId }, catalog: { organizationId } },
      orderBy: [{ storeId: "asc" }, { catalogId: "asc" }],
    }),
  ]);
  const assignments = allAssignments.filter((a) => !a.product.isDeleted);
  const visibleIds = new Set(assignments.map((a) => a.productId));
  for (const c of catalogs)
    for (const p of c.products) if (!p.product.isDeleted) visibleIds.add(p.productId);
  for (const r of rules)
    for (const p of r.grants) if (!p.product.isDeleted) visibleIds.add(p.productId);
  const sources = new Map<string, Source>();
  for (const c of catalogs) {
    const legacyIds = stores
      .filter((s) => !s.directedAssortment && s.productCatalogId === c.id)
      .map((s) => s.id);
    sources.set(c.sourceKey ?? `catalog:${c.id}`, {
      key: c.sourceKey ?? `catalog:${c.id}`,
      catalogId: c.id,
      name: c.name,
      sourceStoreId: c.sourceStoreId,
      sourceName: stores.find((s) => s.id === c.sourceStoreId)?.name ?? null,
      includeFuture: c.includeFuture,
      shared: !c.sourceStoreId,
      memberIds: unique([
        ...c.products.map((p) => p.productId),
        ...allAssignments
          .filter((a) => a.isActive && legacyIds.includes(a.storeId))
          .map((a) => a.productId),
      ]),
      productIds: unique([
        ...c.products.filter((p) => !p.product.isDeleted).map((p) => p.productId),
        ...assignments
          .filter((a) => a.isActive && legacyIds.includes(a.storeId))
          .map((a) => a.productId),
      ]),
    });
  }
  for (const s of stores) {
    const key = `store:${s.id}`,
      prior = sources.get(key),
      baseline = sources.get(`baseline:${s.id}`);
    sources.set(key, {
      key,
      catalogId: prior?.catalogId ?? null,
      name: s.name,
      sourceStoreId: s.id,
      sourceName: s.name,
      includeFuture: true,
      shared: false,
      memberIds: unique([
        ...(baseline?.memberIds ?? []),
        ...allAssignments
          .filter((a) => a.storeId === s.id && a.isDirect && a.isActive)
          .map((a) => a.productId),
      ]),
      productIds: unique([
        ...(baseline?.productIds ?? []),
        ...assignments
          .filter((a) => a.storeId === s.id && a.isDirect && a.isActive)
          .map((a) => a.productId),
      ]),
    });
    if (!s.catalogSourcesConfigured && !s.productCatalogId) {
      const history = allAssignments
        .filter((a) => a.storeId === s.id && a.isActive && !a.isDirect && a.isHistorical)
        .map((a) => a.productId);
      // Also represent unproven assignments which have no recorded granting rule.
      const granted = new Set(
        rules
          .filter((r) => r.targetStoreId === s.id)
          .flatMap((r) => r.grants.map((g) => g.productId)),
      );
      const unmatched = allAssignments
        .filter(
          (a) =>
            a.storeId === s.id &&
            a.isActive &&
            !a.isDirect &&
            !a.isHistorical &&
            !granted.has(a.productId),
        )
        .map((a) => a.productId);
      if (history.length || unmatched.length)
        sources.set(`history:${s.id}`, {
          key: `history:${s.id}`,
          catalogId: null,
          name: `Сохранённый общий каталог · ${s.name}`,
          sourceStoreId: null,
          sourceName: null,
          includeFuture: false,
          shared: true,
          memberIds: unique([...history, ...unmatched]),
          productIds: unique([...history, ...unmatched]).filter((id) => visibleIds.has(id)),
        });
    }
  }
  const ruleKeys = new Map<string, string>();
  for (const r of rules) {
    const direct = sources.get(`store:${r.sourceStoreId}`)!;
    const granted = r.grants.map((g) => g.productId);
    if (granted.every((id) => direct.memberIds.includes(id))) {
      ruleKeys.set(r.id, direct.key);
      continue;
    }
    const key = `rule:${r.id}`;
    ruleKeys.set(r.id, key);
    if (!sources.has(key))
      sources.set(key, {
        key,
        catalogId: null,
        name: `Подборка · ${direct.sourceName}`,
        sourceStoreId: r.sourceStoreId,
        sourceName: direct.sourceName,
        includeFuture: r.active && r.scope === "ALL" && r.includeFuture,
        shared: false,
        memberIds: unique([
          ...granted,
          ...(r.active && r.scope === "ALL" && r.includeFuture ? direct.memberIds : []),
        ]),
        productIds: unique([
          ...granted.filter((id) => visibleIds.has(id)),
          ...(r.active && r.scope === "ALL" && r.includeFuture ? direct.productIds : []),
        ]),
      });
  }
  const settings = (storeId: string): CatalogSettings => {
    const store = stores.find((s) => s.id === storeId);
    if (!store) throw new AppError("storeNotFound", "NOT_FOUND", 404);
    if (store.catalogSourcesConfigured)
      return {
        storeId,
        confirmProductIds: [],
        connections: subscriptions
          .filter((s) => s.storeId === storeId)
          .map((s) => ({
            key: [...sources.values()].find((c) => c.catalogId === s.catalogId)!.key,
            enabled: s.enabled,
            scope: s.scope as "ALL" | "SELECTED",
            productIds: s.selectedProductIds,
          })),
      };
    const connections: CatalogSettings["connections"] = [];
    const hasPeers = stores.some(
      (s) =>
        s.id !== storeId && !s.directedAssortment && s.productCatalogId === store.productCatalogId,
    );
    const ownIds = new Set(sources.get(`store:${storeId}`)!.memberIds);
    const needsShared =
      store.productCatalogId &&
      (hasPeers ||
        sources.get(`catalog:${store.productCatalogId}`)!.memberIds.some((id) => !ownIds.has(id)));
    if (needsShared)
      connections.push({
        key: `catalog:${store.productCatalogId}`,
        enabled: true,
        scope: "ALL",
        productIds: [],
      });
    if (sources.has(`history:${storeId}`))
      connections.push({ key: `history:${storeId}`, enabled: true, scope: "ALL", productIds: [] });
    for (const rule of rules.filter((r) => r.targetStoreId === storeId)) {
      const key = ruleKeys.get(rule.id)!;
      const ids = rule.grants.map((g) => g.productId);
      const activeIds = allAssignments
        .filter((a) => a.storeId === storeId && a.isActive && ids.includes(a.productId))
        .map((a) => a.productId);
      connections.push({
        key,
        enabled: activeIds.length > 0 || rule.active,
        scope: rule.active && rule.scope === "ALL" && rule.includeFuture ? "ALL" : "SELECTED",
        productIds: unique(ids),
      });
    }
    return { storeId, confirmProductIds: [], connections };
  };
  return { stores, assignments, catalogs, rules, subscriptions, sources, settings };
}
const metadata = (s: Source, selectedIds: string[] = []) => {
  const { productIds, memberIds, ...rest } = s;
  void memberIds;
  const available = new Set(productIds);
  return {
    ...rest,
    total: productIds.length,
    unavailableSelectedIds: selectedIds.filter((id) => !available.has(id)),
  };
};
export async function getCatalogSettings(organizationId: string, storeId?: string) {
  return prisma.$transaction(
    async (tx) => {
      const g = await graph(tx, organizationId);
      const stores = g.stores.map((s) => ({
        ...s,
        baseCount: g.sources.get(`store:${s.id}`)!.productIds.length,
        availableCount: g.assignments.filter((a) => a.storeId === s.id && a.isActive).length,
        hasBaseline: g.sources.has(`baseline:${s.id}`),
      }));
      const store = g.stores.find((s) => s.id === storeId) ?? (!storeId ? g.stores[0] : null);
      if (!store) {
        if (storeId) throw new AppError("storeNotFound", "NOT_FOUND", 404);
        return {
          stores,
          store: null,
          sources: [],
          settings: null,
          total: 0,
          ownCount: 0,
        };
      }
      const settings = g.settings(store.id);
      const selectedBySource = new Map(settings.connections.map((c) => [c.key, c.productIds]));
      return {
        stores,
        store,
        sources: [...g.sources.values()].map((s) => metadata(s, selectedBySource.get(s.key) ?? [])),
        settings,
        total: g.assignments.filter((a) => a.storeId === store.id && a.isActive).length,
        ownCount: g.sources.get(`store:${store.id}`)!.productIds.length,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function getCatalogProducts(input: {
  organizationId: string;
  storeId: string;
  key: string;
  search?: string;
  page: number;
  allIds?: boolean;
}) {
  return prisma.$transaction(
    async (tx) => {
      const g = await graph(tx, input.organizationId);
      const settings = g.settings(input.storeId);
      const source = g.sources.get(input.key);
      if (!source) throw new AppError("productCatalogNotFound", "NOT_FOUND", 404);
      const where: Prisma.ProductWhereInput = {
        organizationId: input.organizationId,
        isDeleted: false,
        id: { in: source.productIds },
        ...(input.search
          ? {
              OR: [
                { name: { contains: input.search, mode: "insensitive" } },
                { sku: { contains: input.search, mode: "insensitive" } },
                { barcodes: { some: { value: { contains: input.search } } } },
              ],
            }
          : {}),
      };
      const total = await tx.product.count({ where });
      if (input.allIds && total > 20_000)
        throw new AppError("assortmentSelectionLimit", "BAD_REQUEST", 400);
      const items = await tx.product.findMany({
        where,
        select: { id: true, name: true, sku: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        ...(input.allIds ? {} : { skip: (input.page - 1) * 50, take: 50 }),
      });
      // Build membership lookups once, including for the bulk selection response.
      const activeAssignments = g.assignments.filter(
        (a) => a.storeId === input.storeId && a.isActive,
      );
      const available = new Set(activeAssignments.map((a) => a.productId));
      const own = new Set(activeAssignments.filter((a) => a.isDirect).map((a) => a.productId));
      const connections = settings.connections
        .filter((c) => c.enabled)
        .map((c) => ({
          key: c.key,
          members: new Set(g.sources.get(c.key)?.productIds ?? []),
          selected: c.scope === "SELECTED" ? new Set(c.productIds) : null,
        }));
      const reasons = (id: string) => [
        ...(own.has(id) ? ["OWN"] : []),
        ...connections
          .filter((c) => c.members.has(id) && (!c.selected || c.selected.has(id)))
          .map((c) => c.key),
      ];
      return {
        total,
        page: input.page,
        pageSize: 50,
        items: items.map((p) => ({
          ...p,
          available: available.has(p.id),
          reasons: reasons(p.id),
        })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

async function impact(tx: Tx, organizationId: string, raw: CatalogSettings) {
  const change = catalogSettingsSchema.parse(raw),
    g = await graph(tx, organizationId);
  const before = g.settings(change.storeId),
    store = g.stores.find((s) => s.id === change.storeId)!;
  // A reviewed pre-sharing snapshot is the store's base assortment. It is not
  // inferred ownership, and incoming shares never enter this exportable set.
  if (g.sources.has(`baseline:${store.id}`)) {
    const baseline = change.connections.find((c) => c.key === `baseline:${store.id}`);
    if (!baseline?.enabled || baseline.scope !== "ALL" || baseline.productIds.length)
      throw new AppError("assortmentBaselineRequired", "BAD_REQUEST", 400);
  }
  if (new Set(change.connections.map((c) => c.key)).size !== change.connections.length)
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  const current = new Set(
    g.assignments.filter((a) => a.storeId === store.id && a.isActive).map((a) => a.productId),
  );
  if (change.confirmProductIds.some((id) => !current.has(id)))
    throw new AppError("productAccessDenied", "FORBIDDEN", 403);
  const own = new Set([
    ...g.sources.get(`store:${store.id}`)!.productIds,
    ...change.confirmProductIds,
  ]);
  const desired = new Set(own);
  const materializedIds = new Set([
    ...g.sources.get(`store:${store.id}`)!.memberIds,
    ...change.confirmProductIds,
  ]);
  for (const c of change.connections) {
    const source = g.sources.get(c.key);
    if (!source || c.key === `store:${store.id}`)
      throw new AppError("productCatalogNotFound", "NOT_FOUND", 404);
    const members = new Set(source.memberIds);
    const visible = new Set(source.productIds);
    if (c.scope === "SELECTED" && c.productIds.some((id) => !members.has(id)))
      throw new AppError("productAccessDenied", "FORBIDDEN", 403);
    if (c.enabled) {
      for (const id of c.scope === "ALL" ? source.memberIds : c.productIds) {
        materializedIds.add(id);
        if (visible.has(id)) desired.add(id);
      }
    }
  }
  const removed = [...current].filter((id) => !desired.has(id)),
    added = [...desired].filter((id) => !current.has(id));
  const [stock, documents, products] = await Promise.all([
    tx.inventorySnapshot.findMany({
      where: {
        storeId: store.id,
        productId: { in: removed },
        OR: [{ onHand: { not: 0 } }, { onOrder: { not: 0 } }],
      },
      select: { productId: true, onHand: true, onOrder: true, updatedAt: true },
      orderBy: { id: "asc" },
    }),
    tx.customerOrder.findMany({
      where: {
        organizationId,
        storeId: store.id,
        status: { notIn: ["COMPLETED", "CANCELED"] },
        lines: { some: { productId: { in: removed } } },
      },
      select: {
        id: true,
        number: true,
        status: true,
        isHeld: true,
        isPosSale: true,
        updatedAt: true,
      },
      orderBy: { id: "asc" },
    }),
    tx.product.findMany({
      where: { organizationId, id: { in: [...desired] } },
      select: {
        id: true,
        updatedAt: true,
        barcodes: { select: { value: true } },
        packs: { select: { packBarcode: true } },
      },
      orderBy: { id: "asc" },
    }),
  ]);
  const collision = new Map<string, Set<string>>();
  for (const p of products)
    for (const value of [
      ...p.barcodes.map((b) => b.value),
      ...p.packs.flatMap((p) => (p.packBarcode ? [p.packBarcode] : [])),
    ]) {
      const ids = collision.get(value) ?? new Set();
      ids.add(p.id);
      collision.set(value, ids);
    }
  const confirmed = change.confirmProductIds.filter(
    (id) => !g.sources.get(`store:${store.id}`)!.productIds.includes(id),
  );
  const otherImpacts = g.stores
    .filter((s) => s.id !== store.id)
    .flatMap((s) => {
      const ids = new Set<string>();
      for (const c of g.settings(s.id).connections) {
        const source = g.sources.get(c.key)!;
        if (c.enabled && source.sourceStoreId === store.id && source.includeFuture)
          for (const id of confirmed)
            if (c.scope === "ALL" || c.productIds.includes(id)) ids.add(id);
      }
      for (const r of g.rules.filter(
        (r) =>
          r.sourceStoreId === store.id &&
          r.targetStoreId === s.id &&
          r.active &&
          r.scope === "ALL" &&
          r.includeFuture,
      )) {
        void r;
        for (const id of confirmed) ids.add(id);
      }
      const fresh = [...ids].filter(
        (id) => !g.assignments.some((a) => a.storeId === s.id && a.productId === id && a.isActive),
      );
      return fresh.length ? [{ storeId: s.id, name: s.name, added: fresh.length }] : [];
    });
  const legacyReceivers = unique([
    ...g.stores
      .filter(
        (s) =>
          s.id !== store.id &&
          !s.directedAssortment &&
          s.productCatalogId &&
          s.productCatalogId === store.productCatalogId,
      )
      .map((s) => s.id),
    ...g.subscriptions
      .filter((s) => s.storeId !== store.id && s.enabled && s.catalogId === store.productCatalogId)
      .map((s) => s.storeId),
  ]);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        change,
        stores: g.stores,
        assignments: g.assignments,
        catalogs: g.catalogs,
        rules: g.rules,
        subscriptions: g.subscriptions,
        stock,
        documents,
        products,
      }),
    )
    .digest("hex");
  return {
    g,
    change,
    before,
    store,
    desired: [...materializedIds],
    visibleIds: [...desired],
    removed,
    fingerprint,
    summary: {
      current: current.size,
      result: desired.size,
      added: added.length,
      hidden: removed.length,
      stockPositions: unique(stock.map((s) => s.productId)).length,
      documents,
      otherImpacts,
      confirmed: confirmed.length,
      barcodeConflicts: [...collision.values()].filter((ids) => ids.size > 1).length,
      legacyExit:
        !store.catalogSourcesConfigured &&
        Boolean(store.productCatalogId) &&
        legacyReceivers.length > 0,
      legacyPeers: g.stores.filter((s) => legacyReceivers.includes(s.id)).map((s) => s.name),
    },
  };
}
const sign = (body: string) => {
  if (!process.env.NEXTAUTH_SECRET)
    throw new AppError("unexpectedError", "INTERNAL_SERVER_ERROR", 500);
  return createHmac("sha256", process.env.NEXTAUTH_SECRET).update(body).digest("hex");
};
export async function previewCatalogSettings(input: {
  organizationId: string;
  actorId: string;
  change: CatalogSettings;
}) {
  const r = await prisma.$transaction((tx) => impact(tx, input.organizationId, input.change), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    timeout: 30_000,
  });
  const expires = Date.now() + 15 * 60_000;
  return {
    ...r.summary,
    token: `${expires}.${r.fingerprint}.${sign(`${input.organizationId}:${input.actorId}:${expires}:${r.fingerprint}`)}`,
  };
}
async function materialize(tx: Tx, organizationId: string, source: Source) {
  const catalog = source.catalogId
    ? await tx.productCatalog.findUniqueOrThrow({ where: { id: source.catalogId } })
    : await tx.productCatalog.upsert({
        where: { sourceKey: source.key },
        create: {
          organizationId,
          name: source.name,
          sourceKey: source.key,
          sourceStoreId: source.sourceStoreId,
          includeFuture: source.includeFuture,
        },
        update: {},
      });
  if (source.memberIds.length)
    await tx.productCatalogProduct.createMany({
      data: source.memberIds.map((productId) => ({ catalogId: catalog.id, productId })),
      skipDuplicates: true,
    });
  return catalog;
}
export async function saveCatalogSettings(input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  change: CatalogSettings;
  token: string;
  idempotencyKey: string;
}) {
  let committed;
  for (let attempt = 0; ; attempt++) {
    try {
      committed = await prisma.$transaction(
        async (tx) => {
          await lockAssortment(tx, input.organizationId);
          const result = await withIdempotency(
            tx,
            {
              key: input.idempotencyKey,
              route: "catalogSources.save",
              userId: input.actorId,
              request: toJson({
                change: input.change,
                token: input.token,
              }) as Prisma.InputJsonValue,
            },
            async () => {
              const r = await impact(tx, input.organizationId, input.change);
              const [expires, hash, signature] = input.token.split("."),
                expected = sign(`${input.organizationId}:${input.actorId}:${expires}:${hash}`);
              if (
                !signature ||
                signature.length !== expected.length ||
                !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ||
                Number(expires) < Date.now() ||
                hash !== r.fingerprint
              )
                throw new AppError("assortmentPreviewStale", "CONFLICT", 409);
              // Capture each old path before detaching, including disabled sources for later reconnection.
              if (r.store.productCatalogId)
                await materialize(
                  tx,
                  input.organizationId,
                  r.g.sources.get(`catalog:${r.store.productCatalogId}`)!,
                );
              for (const c of r.before.connections)
                await materialize(tx, input.organizationId, r.g.sources.get(c.key)!);
              await materialize(tx, input.organizationId, r.g.sources.get(`store:${r.store.id}`)!);
              const connections = [];
              for (const c of r.change.connections) {
                const catalog = await materialize(
                  tx,
                  input.organizationId,
                  r.g.sources.get(c.key)!,
                );
                connections.push({ ...c, catalogId: catalog.id });
              }
              await tx.assortmentRule.updateMany({
                where: { organizationId: input.organizationId, targetStoreId: r.store.id },
                data: { active: false },
              });
              await tx.store.update({
                where: { id: r.store.id },
                data: {
                  directedAssortment: true,
                  productCatalogId: null,
                  catalogSourcesConfigured: true,
                },
              });
              await tx.storeCatalog.updateMany({
                where: { storeId: r.store.id },
                data: { enabled: false },
              });
              for (const c of connections)
                await tx.storeCatalog.upsert({
                  where: { storeId_catalogId: { storeId: r.store.id, catalogId: c.catalogId } },
                  create: {
                    storeId: r.store.id,
                    catalogId: c.catalogId,
                    enabled: c.enabled,
                    scope: c.scope,
                    selectedProductIds: unique(c.productIds),
                  },
                  update: {
                    enabled: c.enabled,
                    scope: c.scope,
                    selectedProductIds: unique(c.productIds),
                  },
                });
              if (r.change.confirmProductIds.length)
                await tx.storeProduct.updateMany({
                  where: {
                    organizationId: input.organizationId,
                    storeId: r.store.id,
                    productId: { in: r.change.confirmProductIds },
                  },
                  data: {
                    isDirect: true,
                    isHistorical: false,
                    isActive: true,
                    assignedById: input.actorId,
                  },
                });
              await tx.storeProduct.createMany({
                data: r.desired.map((productId) => ({
                  organizationId: input.organizationId,
                  storeId: r.store.id,
                  productId,
                  isActive: true,
                  isDirect: false,
                  isHistorical: false,
                })),
                skipDuplicates: true,
              });
              const baselineIds = r.g.sources.get(`baseline:${r.store.id}`)?.memberIds ?? [];
              await tx.storeProduct.updateMany({
                where: {
                  storeId: r.store.id,
                  isDirect: false,
                  ...(baselineIds.length ? { productId: { notIn: baselineIds } } : {}),
                },
                data: { isActive: false, isHistorical: false },
              });
              // Retain the baseline's existing editing permissions. Configured stores
              // derive visibility from enabled subscriptions, never this historical flag.
              if (baselineIds.length)
                await tx.storeProduct.updateMany({
                  where: {
                    storeId: r.store.id,
                    isDirect: false,
                    productId: { in: baselineIds },
                  },
                  data: { isActive: false },
                });
              // The BEFORE trigger computes the exact union from enabled catalogues on this update.
              const actual = await tx.storeProduct.findMany({
                where: {
                  storeId: r.store.id,
                  isActive: true,
                  product: { organizationId: input.organizationId, isDeleted: false },
                },
                select: { productId: true },
              });
              if (
                unique(actual.map((p) => p.productId)).join(",") !== unique(r.visibleIds).join(",")
              )
                throw new AppError("assortmentPreviewStale", "CONFLICT", 409);

              await writeAuditLog(tx, {
                organizationId: input.organizationId,
                actorId: input.actorId,
                requestId: input.requestId,
                action: "CATALOG_SOURCES_SAVE",
                entity: "StoreCatalogSettings",
                entityId: r.store.id,
                before: toJson(r.before),
                after: toJson({ settings: r.change, summary: r.summary }),
              });
              return r.summary;
            },
          );
          return result.result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 },
      );
      break;
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034" ||
        attempt >= 2
      )
        throw error;
    }
  }
  await publishAssortmentChange(input.organizationId);
  return committed;
}
export async function catalogSettingsHistory(
  organizationId: string,
  storeId: string,
  page: number,
) {
  if (!(await prisma.store.findFirst({ where: { id: storeId, organizationId } })))
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  const where = { organizationId, entity: "StoreCatalogSettings", entityId: storeId };
  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        actor: { select: { name: true } },
        before: true,
        after: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * 20,
      take: 20,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, total };
}
