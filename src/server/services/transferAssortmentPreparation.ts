import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  transferAssortmentPreparationSchema,
  type TransferAssortmentPreparation,
} from "@/lib/transferAssortmentPreparation";
import { prisma } from "@/server/db/prisma";
import { AppError } from "./errors";
import { assertTrialActive } from "./planLimits";
import { assertUserCanAccessStore, inventoryProductAccessWhere } from "./storeAccess";
import {
  applyCatalogSettingsTx,
  getCatalogProductOptions,
  previewSelectedCatalogProductsTx,
} from "./catalogSources";
import { lockAssortment, publishAssortmentChange } from "./assortmentPolicy";
import { eventBus } from "@/server/events/eventBus";
import { getLogger } from "@/server/logging";
import { withIdempotency } from "./idempotency";
import { writeAuditLog } from "./audit";
import { toJson } from "./json";

type Tx = Prisma.TransactionClient;
type Principal = { organizationId: string; actorId: string };
type Request = Principal & { change: TransferAssortmentPreparation };
type Apply = Request & { token: string; idempotencyKey: string; requestId: string };
type Receipt = { added: number; priceChanges: number; productIds: string[] } | { canceled: true };
type Money = string | null;
type Reason = "copy" | "existing" | "shared" | "sourceMissing" | "disabled";
const key = (productId: string, variantKey: string) => `${productId}:${variantKey}`;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const stale = () => new AppError("transferPreparationStale", "CONFLICT", 409);
const normalize = (change: TransferAssortmentPreparation): TransferAssortmentPreparation => {
  const c = transferAssortmentPreparationSchema.parse(change);
  return {
    ...c,
    selections: [...c.selections].sort((a, b) => a.productId.localeCompare(b.productId)),
    lines: [
      ...new Map(
        c.lines.map((l) => [
          key(l.productId, l.variantId ?? "BASE"),
          { productId: l.productId, variantId: l.variantId ?? null },
        ]),
      ).values(),
    ].sort((a, b) =>
      key(a.productId, a.variantId ?? "BASE").localeCompare(
        key(b.productId, b.variantId ?? "BASE"),
      ),
    ),
  };
};
const sign = (body: string) => {
  if (!process.env.NEXTAUTH_SECRET)
    throw new AppError("serviceUnavailable", "INTERNAL_SERVER_ERROR", 503);
  return createHmac("sha256", process.env.NEXTAUTH_SECRET).update(body).digest("hex");
};
const identity = (input: Request) =>
  hash({
    organizationId: input.organizationId,
    actorId: input.actorId,
    change: normalize(input.change),
  });
function readToken(input: Request & { token: string }) {
  const [expires, state, signature, extra] = input.token.split(".");
  const expected = sign(`${identity(input)}:${expires}:${state}`);
  if (
    extra ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ||
    !/^\d+$/.test(expires) ||
    !/^[a-f0-9]{64}$/.test(state)
  )
    throw stale();
  return { expires: Number(expires), state };
}

async function authorize(tx: Tx, input: Principal & { fromStoreId: string; toStoreId: string }) {
  const actor = await tx.user.findFirst({
    where: { id: input.actorId, organizationId: input.organizationId, isActive: true },
  });
  if (!actor || !actor.organizationId || (actor.role !== "ADMIN" && !actor.isOrgOwner))
    throw new AppError("forbidden", "FORBIDDEN", 403);
  if (input.fromStoreId === input.toStoreId)
    throw new AppError("transferSameStore", "BAD_REQUEST", 400);
  for (const storeId of [input.fromStoreId, input.toStoreId])
    await assertUserCanAccessStore(tx, { ...actor, organizationId: input.organizationId }, storeId);
  const organization = await assertTrialActive(input.organizationId, tx);
  return { actor, organization, pricingAllowed: organization.entitlements.features.storePrices };
}

export async function getTransferAssortmentOptions(
  input: Principal & { fromStoreId: string; toStoreId: string; productIds: string[] },
) {
  const access = await prisma.$transaction(async (tx) => {
    const a = await authorize(tx, input);
    const stores = await tx.store.findMany({
      where: {
        organizationId: input.organizationId,
        id: { in: [input.fromStoreId, input.toStoreId] },
      },
      select: { id: true, name: true },
    });
    return {
      pricingAllowed: a.pricingAllowed,
      sourceName: stores.find((s) => s.id === input.fromStoreId)!.name,
    };
  });
  return {
    ...access,
    products: await getCatalogProductOptions(
      input.organizationId,
      input.toStoreId,
      input.productIds,
    ),
  };
}

async function plan(tx: Tx, input: Request) {
  const c = normalize(input.change);
  const access = await authorize(tx, { ...input, ...c });
  if (c.prices === "MISSING" && !access.pricingAllowed)
    throw new AppError("featureLockedStorePrices", "FORBIDDEN", 403);
  const ids = c.selections.map((s) => s.productId);
  const products = await tx.product.findMany({
    where: {
      organizationId: input.organizationId,
      id: { in: ids },
      isDeleted: false,
      ...inventoryProductAccessWhere(c.fromStoreId),
    },
    select: {
      id: true,
      name: true,
      sku: true,
      basePriceKgs: true,
      updatedAt: true,
      variants: {
        where: {
          isActive: true,
          id: { in: c.lines.flatMap((l) => (l.variantId ? [l.variantId] : [])) },
        },
        select: { id: true, name: true, sku: true, updatedAt: true },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { id: "asc" },
  });
  if (products.length !== ids.length)
    throw new AppError("invalidTransferProducts", "FORBIDDEN", 403);
  for (const line of c.lines)
    if (
      line.variantId &&
      !products.find((p) => p.id === line.productId)?.variants.some((v) => v.id === line.variantId)
    )
      throw new AppError("variantMismatch", "BAD_REQUEST", 400);
  const catalog = await previewSelectedCatalogProductsTx(tx, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    storeId: c.toStoreId,
    selections: c.selections,
  });
  const [organization, standard, types, bindings] = await Promise.all([
    tx.organization.findUniqueOrThrow({
      where: { id: input.organizationId },
      select: { retailWholesaleEnabled: true },
    }),
    c.prices === "NONE"
      ? []
      : tx.storePrice.findMany({
          where: {
            organizationId: input.organizationId,
            storeId: { in: [c.fromStoreId, c.toStoreId] },
            productId: { in: ids },
          },
          orderBy: [{ storeId: "asc" }, { productId: "asc" }, { variantKey: "asc" }],
        }),
    c.prices === "NONE"
      ? []
      : tx.storePriceTypes.findMany({
          where: {
            organizationId: input.organizationId,
            storeId: { in: [c.fromStoreId, c.toStoreId] },
            productId: { in: ids },
          },
          orderBy: [{ storeId: "asc" }, { productId: "asc" }, { variantKey: "asc" }],
        }),
    c.prices === "NONE"
      ? []
      : tx.priceBookStoreItem.findMany({
          where: {
            organizationId: input.organizationId,
            storeId: c.toStoreId,
            productId: { in: ids },
          },
          orderBy: [{ productId: "asc" }, { variantKey: "asc" }],
        }),
  ]);
  const standards = new Map(
    standard.map((r) => [`${r.storeId}:${key(r.productId, r.variantKey)}`, r]),
  );
  const extras = new Map(types.map((r) => [`${r.storeId}:${key(r.productId, r.variantKey)}`, r]));
  const shared = new Map(bindings.map((r) => [key(r.productId, r.variantKey), r]));
  const read = (storeId: string, productId: string, variantKey: string) => {
    const s = standards.get(`${storeId}:${key(productId, variantKey)}`),
      e = extras.get(`${storeId}:${key(productId, variantKey)}`);
    return {
      retail:
        e?.retailPriceKgs?.toString() ??
        s?.priceKgs.toString() ??
        (storeId === c.fromStoreId && variantKey === "BASE"
          ? products.find((p) => p.id === productId)?.basePriceKgs?.toString()
          : null) ??
        null,
      wholesale: organization.retailWholesaleEnabled
        ? (e?.wholesalePriceKgs?.toString() ?? null)
        : null,
    };
  };
  const rows =
    c.prices === "NONE"
      ? []
      : products.flatMap((p) =>
          ["BASE", ...p.variants.map((v) => v.id)].map((variantKey) => {
            const source = read(c.fromStoreId, p.id, variantKey),
              before = read(c.toStoreId, p.id, variantKey);
            const binding = shared.get(key(p.id, variantKey));
            // A shared base price also governs variants without their own explicit price.
            const baseBinding = variantKey === "BASE" ? undefined : shared.get(key(p.id, "BASE"));
            const choose = (kind: "retail" | "wholesale"): { value: Money; reason: Reason } => {
              if (kind === "wholesale" && !organization.retailWholesaleEnabled)
                return { value: before[kind], reason: "disabled" };
              if (before[kind] !== null) return { value: before[kind], reason: "existing" };
              if (
                binding?.[kind === "retail" ? "retailShared" : "wholesaleShared"] ||
                baseBinding?.[kind === "retail" ? "retailShared" : "wholesaleShared"]
              )
                return { value: before[kind], reason: "shared" };
              return source[kind] === null
                ? { value: before[kind], reason: "sourceMissing" }
                : { value: source[kind], reason: "copy" };
            };
            const retail = choose("retail"),
              wholesale = choose("wholesale");
            return {
              productId: p.id,
              name: p.name,
              sku: p.sku,
              variantKey,
              variantName: p.variants.find((v) => v.id === variantKey)?.name ?? null,
              source,
              before,
              after: { retail: retail.value, wholesale: wholesale.value },
              reasons: { retail: retail.reason, wholesale: wholesale.reason },
            };
          }),
        );
  return {
    catalog,
    rows,
    retailWholesaleEnabled: organization.retailWholesaleEnabled,
    state: hash({
      identity: identity(input),
      catalog: catalog.token.split(".")[1],
      products,
      standard,
      types,
      bindings,
      organization,
      authority: {
        role: access.actor.role,
        owner: access.actor.isOrgOwner,
        organization: access.organization,
        pricingAllowed: access.pricingAllowed,
      },
    }),
    priceChanges: rows.filter((r) => r.reasons.retail === "copy" || r.reasons.wholesale === "copy")
      .length,
  };
}

export async function previewTransferAssortmentPreparation(input: Request) {
  return prisma.$transaction(
    async (tx) => {
      const p = await plan(tx, input),
        expires = Date.now() + 10 * 60_000;
      return {
        added: p.catalog.added,
        priceChanges: p.priceChanges,
        rows: p.rows,
        retailWholesaleEnabled: p.retailWholesaleEnabled,
        token: `${expires}.${p.state}.${sign(`${identity(input)}:${expires}:${p.state}`)}`,
      };
    },
    { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 30_000 },
  );
}

async function writePrices(tx: Tx, input: Request, p: Awaited<ReturnType<typeof plan>>) {
  const rows = p.rows.filter((r) => r.reasons.retail === "copy" || r.reasons.wholesale === "copy");
  // Bounded, parameterized batches reuse the same price tables and inheritance
  // triggers as the regular editors. Never touch discounts, costs or stock.
  for (let at = 0; at < rows.length; at += 200) {
    const data = JSON.stringify(
      rows.slice(at, at + 200).map((r) => ({
        id: randomUUID(),
        productId: r.productId,
        variantKey: r.variantKey,
        retail: r.reasons.retail === "copy" ? r.after.retail : null,
        wholesale: r.reasons.wholesale === "copy" ? r.after.wholesale : null,
      })),
    );
    await tx.$executeRaw`
      INSERT INTO "StorePrice" (id,"organizationId","storeId","productId","variantId","variantKey","priceKgs","updatedAt","updatedById")
      SELECT r.id, ${input.organizationId}, ${input.change.toStoreId}, r."productId", NULLIF(r."variantKey",'BASE'), r."variantKey", r.retail::numeric, CURRENT_TIMESTAMP, ${input.actorId}
      FROM jsonb_to_recordset(${data}::jsonb) AS r(id text,"productId" text,"variantKey" text,retail text,wholesale text)
      WHERE r.retail IS NOT NULL
      ON CONFLICT ("organizationId","storeId","productId","variantKey") DO UPDATE SET
      "priceKgs"=EXCLUDED."priceKgs","updatedAt"=EXCLUDED."updatedAt","updatedById"=EXCLUDED."updatedById"`;
    if (p.retailWholesaleEnabled)
      await tx.$executeRaw`
      INSERT INTO "StorePriceTypes" (id,"organizationId","storeId","productId","variantId","variantKey","retailPriceKgs","wholesalePriceKgs","updatedAt","updatedById")
      SELECT r.id, ${input.organizationId}, ${input.change.toStoreId}, r."productId", NULLIF(r."variantKey",'BASE'), r."variantKey", r.retail::numeric, r.wholesale::numeric, CURRENT_TIMESTAMP, ${input.actorId}
      FROM jsonb_to_recordset(${data}::jsonb) AS r(id text,"productId" text,"variantKey" text,retail text,wholesale text)
      ON CONFLICT ("organizationId","storeId","productId","variantKey") DO UPDATE SET
      "retailPriceKgs"=COALESCE(EXCLUDED."retailPriceKgs","StorePriceTypes"."retailPriceKgs"),
      "wholesalePriceKgs"=COALESCE(EXCLUDED."wholesalePriceKgs","StorePriceTypes"."wholesalePriceKgs"),
      "updatedAt"=EXCLUDED."updatedAt","updatedById"=EXCLUDED."updatedById"`;
    else
      await tx.$executeRaw`
      UPDATE "StorePriceTypes" t SET "retailPriceKgs"=r.retail::numeric,"updatedAt"=CURRENT_TIMESTAMP,"updatedById"=${input.actorId}
      FROM jsonb_to_recordset(${data}::jsonb) AS r("productId" text,"variantKey" text,retail text)
      WHERE t."organizationId"=${input.organizationId} AND t."storeId"=${input.change.toStoreId} AND t."productId"=r."productId"
        AND t."variantKey"=r."variantKey" AND t."retailPriceKgs" IS NOT NULL AND r.retail IS NOT NULL`;
  }
}

export async function applyTransferAssortmentPreparation(input: Apply) {
  const token = readToken(input);
  let receipt: Receipt | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      receipt = await prisma.$transaction(
        async (tx) => {
          await authorize(tx, { ...input, ...input.change });
          await lockAssortment(tx, input.organizationId);
          const result = await withIdempotency<Receipt>(
            tx,
            {
              key: input.idempotencyKey,
              route: "inventory.transferAssortment",
              userId: input.actorId,
              request: toJson({
                organizationId: input.organizationId,
                change: normalize(input.change),
                token: input.token,
              }),
            },
            async () => {
              const p = await plan(tx, input);
              if (token.expires < Date.now() || token.state !== p.state) throw stale();
              await applyCatalogSettingsTx(tx, {
                organizationId: input.organizationId,
                actorId: input.actorId,
                requestId: input.requestId,
                change: p.catalog.change,
                token: p.catalog.token,
              });
              await writePrices(tx, input, p);
              await writeAuditLog(tx, {
                organizationId: input.organizationId,
                actorId: input.actorId,
                requestId: input.requestId,
                action: "TRANSFER_ASSORTMENT_PREPARE",
                entity: "Store",
                entityId: input.change.toStoreId,
                before: toJson(
                  p.rows.map((r) => ({
                    productId: r.productId,
                    variantKey: r.variantKey,
                    ...r.before,
                  })),
                ),
                after: toJson({
                  change: normalize(input.change),
                  rows: p.rows,
                  added: p.catalog.added,
                  priceChanges: p.priceChanges,
                }),
              });
              return {
                added: p.catalog.added,
                priceChanges: p.priceChanges,
                productIds: input.change.selections.map((s) => s.productId),
              };
            },
          );
          return result.result;
        },
        { isolationLevel: "Serializable", maxWait: 10_000, timeout: 60_000 },
      );
      break;
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        !["P2034", "P2002"].includes(error.code) ||
        attempt >= 2
      )
        throw error;
    }
  }
  if (!receipt || "canceled" in receipt)
    throw new AppError("transferPreparationAttemptClosed", "CONFLICT", 409);
  await publishAssortmentChange(input.organizationId);
  try {
    const [{ invalidateBazaarCatalogCacheForStore }, { invalidateBazaarApiProductsCacheForStore }] =
      await Promise.all([import("./bazaarCatalog"), import("./bazaarApi")]);
    await Promise.all([
      invalidateBazaarCatalogCacheForStore(input.organizationId, input.change.toStoreId),
      invalidateBazaarApiProductsCacheForStore(input.organizationId, input.change.toStoreId),
    ]);
    eventBus.publish({ type: "pricing.updated", payload: { storeId: input.change.toStoreId } });
    for (const productId of receipt.productIds)
      eventBus.publish({
        type: "products.updated",
        payload: { storeId: input.change.toStoreId, productId },
      });
  } catch {
    getLogger().warn(
      { storeId: input.change.toStoreId },
      "committed transfer preparation notification failed",
    );
  }
  return receipt;
}

/** Closes an uncommitted attempt under the same lock/key; a late original cannot apply afterwards. */
export async function reconcileTransferAssortmentPreparation(input: Apply) {
  readToken(input); // Expired signed requests may still recover an already committed receipt.
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          await authorize(tx, { ...input, ...input.change });
          await lockAssortment(tx, input.organizationId);
          return withIdempotency<Receipt>(
            tx,
            {
              key: input.idempotencyKey,
              route: "inventory.transferAssortment",
              userId: input.actorId,
              request: toJson({
                organizationId: input.organizationId,
                change: normalize(input.change),
                token: input.token,
              }),
            },
            async () => ({ canceled: true }),
          );
        },
        { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 },
      );
      return "canceled" in result.result
        ? { status: "CANCELED" as const }
        : { status: "APPLIED" as const, ...result.result };
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        !["P2034", "P2002"].includes(error.code) ||
        attempt >= 2
      )
        throw error;
    }
  }
}
