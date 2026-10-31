import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { ProductStorePreparation } from "@/lib/productStorePreparation";
import { AppError } from "./errors";
import { assertUserCanAccessProducts } from "./productAccess";
import { assertUserCanAccessStore, type StoreAccessUser } from "./storeAccess";
import { assertFeatureEnabled } from "./planLimits";
import { lockAssortment, publishAssortmentChange } from "./assortmentPolicy";
import { saveProductPriceTypes, syncExistingRetailPrice } from "./productPriceTypes";
import { publishProductChange } from "./productChangeEvents";
import { withIdempotency } from "./idempotency";
import { writeAuditLog } from "./audit";
import { toJson } from "./json";

type Request = { user: StoreAccessUser; change: ProductStorePreparation };
type Receipt = { productId: string; additions: number; priceChanges: number } | { canceled: true };
type Tx = Prisma.TransactionClient;
const stale = () => new AppError("productPreparationStale", "CONFLICT", 409);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalize = (c: ProductStorePreparation): ProductStorePreparation => ({
  ...c,
  targetStoreIds: [...new Set(c.targetStoreIds)].sort(),
});
const secret = () => {
  if (!process.env.NEXTAUTH_SECRET)
    throw new AppError("serviceUnavailable", "INTERNAL_SERVER_ERROR", 503);
  return process.env.NEXTAUTH_SECRET;
};
const signature = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");
function readToken(token: string) {
  try {
    const [body, sig, extra] = token.split(".");
    const expected = signature(body);
    if (
      extra ||
      !sig ||
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    )
      throw stale();
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      authority: string;
      state: string;
      expires: number;
    };
    if (
      typeof value.authority !== "string" ||
      typeof value.state !== "string" ||
      !Number.isFinite(value.expires)
    )
      throw stale();
    return value;
  } catch {
    throw stale();
  }
}
const authority = (r: Request) =>
  hash({ organizationId: r.user.organizationId, actorId: r.user.id, change: normalize(r.change) });

async function authorize(tx: Tx, input: Request) {
  const actor = await tx.user.findFirst({
    where: { id: input.user.id, organizationId: input.user.organizationId, isActive: true },
  });
  if (!actor || (actor.role !== "ADMIN" && actor.role !== "MANAGER"))
    throw new AppError("forbidden", "FORBIDDEN", 403);
  const user = { ...actor, organizationId: input.user.organizationId };
  for (const storeId of new Set([
    ...input.change.targetStoreIds,
    ...(input.change.sourceStoreId ? [input.change.sourceStoreId] : []),
  ]))
    await assertUserCanAccessStore(tx, user, storeId);
  await assertUserCanAccessProducts(tx, user, [input.change.productId], {
    writable: input.change.addToAssortment,
    allowShared: !input.change.addToAssortment,
  });
}

async function plan(tx: Tx, input: Request) {
  await authorize(tx, input);
  const c = normalize(input.change),
    org = input.user.organizationId;
  const storeIds = [
    ...new Set([...c.targetStoreIds, ...(c.sourceStoreId ? [c.sourceStoreId] : [])]),
  ].sort();
  const [product, stores, organization, standards, extras, memberships, sources] =
    await Promise.all([
      tx.product.findFirst({
        where: { id: c.productId, organizationId: org, isDeleted: false },
        select: {
          id: true,
          name: true,
          sku: true,
          basePriceKgs: true,
          updatedAt: true,
          variants: {
            where: { isActive: true },
            select: { id: true, name: true, sku: true, updatedAt: true },
            orderBy: { id: "asc" },
          },
          storeProducts: { where: { storeId: { in: storeIds } }, orderBy: { storeId: "asc" } },
        },
      }),
      tx.store.findMany({
        where: { id: { in: storeIds }, organizationId: org },
        select: { id: true, name: true, catalogSourcesConfigured: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
      tx.organization.findUniqueOrThrow({
        where: { id: org },
        select: { retailWholesaleEnabled: true },
      }),
      tx.storePrice.findMany({
        where: { organizationId: org, productId: c.productId, storeId: { in: storeIds } },
        orderBy: [{ storeId: "asc" }, { variantKey: "asc" }],
      }),
      tx.storePriceTypes.findMany({
        where: { organizationId: org, productId: c.productId, storeId: { in: storeIds } },
        orderBy: [{ storeId: "asc" }, { variantKey: "asc" }],
      }),
      tx.priceBookStoreItem.findMany({
        where: { organizationId: org, productId: c.productId, storeId: { in: storeIds } },
        orderBy: [{ storeId: "asc" }, { variantKey: "asc" }, { id: "asc" }],
      }),
      tx.storeCatalog.findMany({
        where: {
          storeId: { in: c.targetStoreIds },
          store: { organizationId: org },
          catalog: { products: { some: { productId: c.productId } } },
        },
        select: {
          storeId: true,
          catalogId: true,
          enabled: true,
          scope: true,
          selectedProductIds: true,
        },
        orderBy: [{ storeId: "asc" }, { catalogId: "asc" }],
      }),
    ]);
  if (!product) throw new AppError("productNotFound", "NOT_FOUND", 404);
  if (stores.length !== storeIds.length) throw new AppError("storeNotFound", "NOT_FOUND", 404);
  if ((product.variants.length + 1) * c.targetStoreIds.length > 5000)
    throw new AppError("priceBookScopeTooLarge", "BAD_REQUEST", 400);
  if (
    c.sourceStoreId &&
    !product.storeProducts.some((a) => a.storeId === c.sourceStoreId && a.isActive && !a.isHidden)
  )
    throw new AppError("productNotAvailableInStore", "FORBIDDEN", 403);
  const price = (storeId: string, variantKey: string) => {
    const standard = standards.find((p) => p.storeId === storeId && p.variantKey === variantKey);
    const extra = extras.find((p) => p.storeId === storeId && p.variantKey === variantKey);
    return {
      retail: extra?.retailPriceKgs?.toNumber() ?? standard?.priceKgs?.toNumber() ?? null,
      wholesale: organization.retailWholesaleEnabled
        ? (extra?.wholesalePriceKgs?.toNumber() ?? null)
        : null,
    };
  };
  const rows = c.targetStoreIds.map((storeId) => {
    const store = stores.find((s) => s.id === storeId)!;
    const assignment = product.storeProducts.find((a) => a.storeId === storeId);
    const available = Boolean(assignment?.isActive && !assignment.isHidden);
    // Match the existing assignment policy. Never unhide or bypass a revoked source.
    const revoked = sources.some(
      (s) =>
        s.storeId === storeId &&
        (!s.enabled || (s.scope === "SELECTED" && !s.selectedProductIds.includes(c.productId))),
    );
    const blocked = assignment?.isHidden
      ? ("hidden" as const)
      : !available &&
          store.catalogSourcesConfigured &&
          (revoked || (assignment && !assignment.isDirect))
        ? ("catalog" as const)
        : !available && !c.addToAssortment
          ? ("absent" as const)
          : null;
    const prices = [null, ...product.variants.map((v) => v.id)].map((variantId) => {
      const key = variantId ?? "BASE",
        before = price(storeId, key);
      const source = c.sourceStoreId
        ? price(c.sourceStoreId, key)
        : { retail: null, wholesale: null };
      if (!variantId && source.retail == null && product.basePriceKgs != null)
        source.retail = product.basePriceKgs.toNumber();
      const next = (old: number | null, value: number | null) =>
        c.prices !== "NONE" && value != null && (c.prices === "REPLACE" || old == null)
          ? value
          : old;
      return {
        variantId,
        label: variantId
          ? product.variants.find((v) => v.id === variantId)!.name ||
            product.variants.find((v) => v.id === variantId)!.sku ||
            product.name
          : product.name,
        before,
        after: {
          retail: next(before.retail, source.retail),
          wholesale: next(before.wholesale, source.wholesale),
        },
        source,
      };
    });
    return {
      storeId,
      storeName: store.name,
      available,
      add: !available && !blocked && c.addToAssortment,
      blocked,
      prices,
    };
  });
  return {
    productName: product.name,
    retailWholesaleEnabled: organization.retailWholesaleEnabled,
    rows,
    state: hash({ product, stores, organization, standards, extras, memberships, sources }),
    canApply: rows.every((r) => !r.blocked),
    additions: rows.filter((r) => r.add).length,
    priceChanges: rows.reduce(
      (n, r) =>
        n +
        r.prices.filter(
          (p) => p.before.retail !== p.after.retail || p.before.wholesale !== p.after.wholesale,
        ).length,
      0,
    ),
  };
}

async function checkFeature(input: Request) {
  if (input.change.prices !== "NONE")
    await assertFeatureEnabled({
      organizationId: input.user.organizationId,
      feature: "storePrices",
    });
}
export async function previewProductStorePreparation(input: Request) {
  await checkFeature(input);
  return prisma.$transaction(
    async (tx) => {
      const p = await plan(tx, input);
      const body = Buffer.from(
        JSON.stringify({
          authority: authority(input),
          state: p.state,
          expires: Date.now() + 600_000,
        }),
      ).toString("base64url");
      return {
        productName: p.productName,
        rows: p.rows,
        canApply: p.canApply,
        additions: p.additions,
        priceChanges: p.priceChanges,
        token: `${body}.${signature(body)}`,
      };
    },
    { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 30_000 },
  );
}

export async function applyProductStorePreparation(
  input: Request & { token: string; idempotencyKey: string; requestId: string },
) {
  await checkFeature(input);
  const token = readToken(input.token);
  if (token.authority !== authority(input)) throw stale();
  const c = normalize(input.change);
  let result: { productId: string; additions: number; priceChanges: number };
  try {
    const committed = await prisma.$transaction(
      async (tx) => {
        await authorize(tx, input);
        return withIdempotency<Receipt>(
          tx,
          {
            key: input.idempotencyKey,
            route: "products.prepareStores",
            userId: input.user.id,
            request: toJson({
              change: c,
              token: input.token,
              organizationId: input.user.organizationId,
            }),
          },
          async () => {
            await lockAssortment(tx, input.user.organizationId);
            const p = await plan(tx, input);
            if (token.expires < Date.now() || token.state !== p.state) throw stale();
            if (!p.canApply) throw new AppError("assortmentUseSourceEditor", "CONFLICT", 409);
            for (const row of p.rows) {
              if (row.add)
                await tx.storeProduct.upsert({
                  where: { storeId_productId: { storeId: row.storeId, productId: c.productId } },
                  create: {
                    organizationId: input.user.organizationId,
                    storeId: row.storeId,
                    productId: c.productId,
                    isActive: true,
                    isDirect: true,
                    isHistorical: false,
                    assignedById: input.user.id,
                  },
                  update: { isActive: true, assignedById: input.user.id },
                });
              const changedPrices = row.prices
                .map((price) => ({
                  variantId: price.variantId ?? undefined,
                  retailPriceKgs:
                    price.after.retail !== price.before.retail ? price.after.retail : undefined,
                  wholesalePriceKgs:
                    price.after.wholesale !== price.before.wholesale
                      ? price.after.wholesale
                      : undefined,
                }))
                .filter(
                  (price) =>
                    price.retailPriceKgs !== undefined || price.wholesalePriceKgs !== undefined,
                );
              if (p.retailWholesaleEnabled && changedPrices.length) {
                await saveProductPriceTypes(tx, {
                  organizationId: input.user.organizationId,
                  actorId: input.user.id,
                  requestId: input.requestId,
                  storeId: row.storeId,
                  productId: c.productId,
                  prices: changedPrices,
                  // The aggregate audit below includes every before/after value atomically.
                  audit: false,
                });
              } else
                for (const price of changedPrices) {
                  if (price.retailPriceKgs == null) continue;
                  const key = {
                    organizationId: input.user.organizationId,
                    storeId: row.storeId,
                    productId: c.productId,
                    variantKey: price.variantId ?? "BASE",
                  };
                  await tx.storePrice.upsert({
                    where: { organizationId_storeId_productId_variantKey: key },
                    create: {
                      ...key,
                      variantId: price.variantId,
                      priceKgs: price.retailPriceKgs,
                      updatedById: input.user.id,
                    },
                    update: { priceKgs: price.retailPriceKgs, updatedById: input.user.id },
                  });
                  await syncExistingRetailPrice(tx, {
                    ...key,
                    priceKgs: price.retailPriceKgs,
                    actorId: input.user.id,
                  });
                }
            }
            await writeAuditLog(tx, {
              organizationId: input.user.organizationId,
              actorId: input.user.id,
              requestId: input.requestId,
              action: "PRODUCT_STORE_PREPARE",
              entity: "Product",
              entityId: c.productId,
              before: toJson(
                p.rows.map((r) => ({
                  storeId: r.storeId,
                  available: r.available,
                  prices: r.prices.map((p) => ({ variantId: p.variantId, ...p.before })),
                })),
              ),
              after: toJson({
                change: c,
                rows: p.rows,
                additions: p.additions,
                priceChanges: p.priceChanges,
              }),
            });
            return { productId: c.productId, additions: p.additions, priceChanges: p.priceChanges };
          },
        );
      },
      { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 },
    );
    if ("canceled" in committed.result)
      throw new AppError("productPreparationAttemptClosed", "CONFLICT", 409);
    result = committed.result;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(e.code))
      throw stale();
    throw e;
  }
  if (result.additions) await publishAssortmentChange(input.user.organizationId);
  await publishProductChange(input.user.organizationId, c.productId);
  return result;
}

/** Claims the same key. A late original cannot run after an unresolved attempt is closed. */
export async function reconcileProductStorePreparation(
  input: Request & { token: string; idempotencyKey: string },
) {
  const token = readToken(input.token);
  if (token.authority !== authority(input)) throw stale();
  const result = await prisma.$transaction(
    async (tx) => {
      await authorize(tx, input);
      return withIdempotency<Receipt>(
        tx,
        {
          key: input.idempotencyKey,
          route: "products.prepareStores",
          userId: input.user.id,
          request: toJson({
            change: normalize(input.change),
            token: input.token,
            organizationId: input.user.organizationId,
          }),
        },
        async () => ({ canceled: true }),
      );
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
  return "canceled" in result.result
    ? { status: "CANCELED" as const }
    : { status: "APPLIED" as const, ...result.result };
}
