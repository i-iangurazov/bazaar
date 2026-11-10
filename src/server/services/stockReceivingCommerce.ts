import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  stockReceivingCommerceSchema,
  reviewedStockReceivingSchema,
  type StockReceivingCommerce,
  type ReviewedStockReceiving,
  type ReceivingCommercePreview,
  type ReceivingCostState,
} from "@/lib/stockReceivingCommerce";
import { normalizeCurrencyCode, normalizeCurrencyRateKgsPerUnit } from "@/lib/currency";
import { isValidQuantity } from "@/lib/quantity";
import { prisma } from "@/server/db/prisma";
import { AppError } from "./errors";
import { assertTrialActive, getOrganizationPlan } from "./planLimits";
import { assertUserCanAccessStore, inventoryProductAccessWhere } from "./storeAccess";
import { withIdempotency } from "./idempotency";
import { toJson } from "./json";
import {
  postStockReceivingTx,
  publishStockReceivingResult,
  type StockReceivingResult,
} from "./inventory";
import { readStoreStockValuation } from "./storeStockValuation";
import { resolveStoreSellingPrice } from "./storeSellingPrice";
import { saveProductPriceTypes, syncExistingRetailPrice } from "./productPriceTypes";
import { writeAuditLog } from "./audit";
import { publishProductChange } from "./productChangeEvents";
import { getLogger } from "@/server/logging";

type Tx = Prisma.TransactionClient;
type Principal = { organizationId: string; actorId: string };
type PreviewInput = Principal & { receiving: StockReceivingCommerce };
type ApplyInput = Principal & ReviewedStockReceiving & { requestId: string };
type Receipt =
  | { status: "POSTED"; result: StockReceivingResult }
  | { status: "CANCELED"; result: null };
const route = "inventory.stockReceivingReviewed";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const stale = () => new AppError("receivingReviewStale", "CONFLICT", 409);

function normalize(receiving: StockReceivingCommerce): StockReceivingCommerce {
  const r = stockReceivingCommerceSchema.parse(receiving);
  const keys = r.lines.map((l) => `${l.productId}:${l.variantId ?? "BASE"}`);
  if (new Set(keys).size !== keys.length)
    throw new AppError("duplicateLineItem", "BAD_REQUEST", 400);
  return {
    storeId: r.storeId,
    date: r.date,
    supplierName: r.supplierName || undefined,
    referenceNumber: r.referenceNumber || undefined,
    note: r.note || undefined,
    lines: r.lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId ?? null,
      quantity: l.quantity,
      unitCost: l.unitCost,
      salePriceKgs: l.salePriceKgs,
    })),
  };
}
const identity = (input: PreviewInput) =>
  hash({
    organizationId: input.organizationId,
    actorId: input.actorId,
    receiving: normalize(input.receiving),
  });
function signature(input: PreviewInput, expires: string, state: string) {
  if (!process.env.NEXTAUTH_SECRET)
    throw new AppError("serviceUnavailable", "INTERNAL_SERVER_ERROR", 503);
  return createHmac("sha256", process.env.NEXTAUTH_SECRET)
    .update(`receiving-review:${identity(input)}:${expires}:${state}`)
    .digest("hex");
}
function readToken(input: PreviewInput & { token: string }) {
  const [expires, state, signed, extra] = input.token.split(".");
  if (
    extra ||
    !/^\d{10,16}$/.test(expires ?? "") ||
    !/^[a-f0-9]{64}$/.test(state ?? "") ||
    !/^[a-f0-9]{64}$/.test(signed ?? "")
  )
    throw stale();
  const expected = signature(input, expires, state);
  if (!timingSafeEqual(Buffer.from(signed), Buffer.from(expected))) throw stale();
  return { expires: Number(expires), state };
}
async function authorize(tx: Tx, input: Principal & { storeId: string }) {
  const actor = await tx.user.findFirst({
    where: { id: input.actorId, organizationId: input.organizationId, isActive: true },
  });
  if (!actor || !["ADMIN", "MANAGER"].includes(actor.role))
    throw new AppError("forbidden", "FORBIDDEN", 403);
  await assertUserCanAccessStore(
    tx,
    { ...actor, organizationId: input.organizationId },
    input.storeId,
  );
  return actor;
}

async function plan(tx: Tx, input: PreviewInput) {
  const r = normalize(input.receiving);
  await authorize(tx, { ...input, storeId: r.storeId });
  const ids = [...new Set(r.lines.map((l) => l.productId))].sort();
  const [store, organization, products, standards, extras, bindings, access] = await Promise.all([
    tx.store.findFirstOrThrow({
      where: { id: r.storeId, organizationId: input.organizationId },
      select: { id: true, currencyCode: true, currencyRateKgsPerUnit: true },
    }),
    tx.organization.findUniqueOrThrow({
      where: { id: input.organizationId },
      select: { retailWholesaleEnabled: true },
    }),
    tx.product.findMany({
      where: {
        organizationId: input.organizationId,
        id: { in: ids },
        isDeleted: false,
        ...inventoryProductAccessWhere(r.storeId),
      },
      include: {
        baseUnit: true,
        variants: {
          where: {
            isActive: true,
            id: { in: r.lines.flatMap((l) => (l.variantId ? [l.variantId] : [])) },
          },
          orderBy: { id: "asc" },
        },
      },
      orderBy: { id: "asc" },
    }),
    tx.storePrice.findMany({
      where: { organizationId: input.organizationId, storeId: r.storeId, productId: { in: ids } },
      orderBy: [{ productId: "asc" }, { variantKey: "asc" }],
    }),
    tx.storePriceTypes.findMany({
      where: { organizationId: input.organizationId, storeId: r.storeId, productId: { in: ids } },
      orderBy: [{ productId: "asc" }, { variantKey: "asc" }],
    }),
    tx.priceBookStoreItem.findMany({
      where: { organizationId: input.organizationId, storeId: r.storeId, productId: { in: ids } },
      orderBy: [{ productId: "asc" }, { variantKey: "asc" }],
    }),
    getOrganizationPlan(input.organizationId, tx),
  ]);
  if (products.length !== ids.length) throw new AppError("invalidProducts", "FORBIDDEN", 403);
  for (const line of r.lines) {
    const product = products.find((p) => p.id === line.productId)!;
    if (line.variantId && !product.variants.some((v) => v.id === line.variantId))
      throw new AppError("variantMismatch", "BAD_REQUEST", 400);
    if (!isValidQuantity(line.quantity, product.baseUnit.quantityPrecision))
      throw new AppError("wholeQuantityRequired", "BAD_REQUEST", 400);
  }
  const pricingAllowed = access.entitlements.features.storePrices;
  if (!pricingAllowed && r.lines.some((l) => l.salePriceKgs !== undefined))
    throw new AppError("featureLockedStorePrices", "FORBIDDEN", 403);
  const valuation = await readStoreStockValuation(tx, {
    organizationId: input.organizationId,
    storeId: r.storeId,
    lines: r.lines,
    movementDate: r.date ? new Date(r.date) : undefined,
  });
  const currencyCode = normalizeCurrencyCode(store.currencyCode);
  const currencyRateKgsPerUnit = normalizeCurrencyRateKgsPerUnit(
    Number(store.currencyRateKgsPerUnit),
    currencyCode,
  );
  const lines: ReceivingCommercePreview["lines"] = r.lines.map((l) => {
    const product = products.find((p) => p.id === l.productId)!;
    const key = l.variantId ?? "BASE";
    const s = standards.find((p) => p.productId === l.productId && p.variantKey === key);
    const e = extras.find((p) => p.productId === l.productId && p.variantKey === key);
    const fallback = product.basePriceKgs;
    const selected = resolveStoreSellingPrice({
      enabled: organization.retailWholesaleEnabled,
      mode: "RETAIL",
      standard: s?.priceKgs ?? fallback,
      retail: e?.retailPriceKgs,
      wholesale: e?.wholesalePriceKgs,
      preferStandard: s?.priceKgs != null || (!l.variantId && fallback != null),
    });
    const currentSalePriceKgs = selected.price === null ? null : Number(selected.price);
    const binding = bindings.find((b) => b.productId === l.productId && b.variantKey === key);
    const v = valuation.lines.find(
      (v) => v.productId === l.productId && v.variantId === (l.variantId ?? null),
    )!;
    const point = (p: typeof v.current): ReceivingCostState => ({
      quantity: p.quantity,
      unitCostKgs: p.unitCostKgs,
      status: p.status,
      reason: p.reason,
    });
    return {
      productId: l.productId,
      variantId: l.variantId ?? null,
      unitId: product.baseUnitId,
      unitLabel: product.unit,
      currentSalePriceKgs,
      // Match the actual POS resolver: an unpriced variant falls back to the
      // product default, not to the BASE store/common-price binding.
      sharedRetail: Boolean(binding?.retailShared),
      changesSalePrice: l.salePriceKgs !== undefined && l.salePriceKgs !== currentSalePriceKgs,
      valuation: { current: point(v.current), projected: point(v.projected) },
    };
  });
  const state = hash({
    store,
    organization,
    products,
    standards,
    extras,
    bindings,
    pricingAllowed,
    valuation: valuation.fingerprint,
  });
  return {
    state,
    pricingAllowed,
    retailWholesaleEnabled: organization.retailWholesaleEnabled,
    currencyCode,
    currencyRateKgsPerUnit,
    lines,
  };
}

export async function previewStockReceiving(
  input: PreviewInput,
): Promise<ReceivingCommercePreview> {
  const p = await prisma.$transaction((tx) => plan(tx, input), {
    isolationLevel: "RepeatableRead",
    maxWait: 10_000,
    timeout: 30_000,
  });
  const expires = String(Date.now() + 15 * 60_000);
  const { state, ...preview } = p;
  return {
    ...preview,
    expiresAt: new Date(Number(expires)).toISOString(),
    token: `${expires}.${state}.${signature(input, expires, state)}`,
  };
}

async function run(input: ApplyInput, reconcile: boolean) {
  reviewedStockReceivingSchema.parse(input);
  const receiving = normalize(input.receiving);
  const token = readToken({ ...input, receiving }); // Recovery/replay does not require an unexpired review.
  let published: StockReceivingResult | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      const receipt = await prisma.$transaction(
        async (tx) => {
          await authorize(tx, { ...input, storeId: receiving.storeId });
          const claimed = await withIdempotency<Receipt>(
            tx,
            {
              key: input.idempotencyKey,
              route,
              userId: input.actorId,
              request: toJson({
                organizationId: input.organizationId,
                receiving,
                token: input.token,
              }),
            },
            async () => {
              if (reconcile) {
                await writeAuditLog(tx, {
                  organizationId: input.organizationId,
                  actorId: input.actorId,
                  requestId: input.requestId,
                  action: "RECEIVING_ATTEMPT_CANCELED",
                  entity: "IdempotencyKey",
                  entityId: input.idempotencyKey,
                  before: null,
                  after: { storeId: receiving.storeId, canceled: true },
                });
                return { status: "CANCELED", result: null };
              }
              await assertTrialActive(input.organizationId, tx);
              if (token.expires <= Date.now()) throw stale();
              const ids = [...new Set(receiving.lines.map((l) => l.productId))].sort();
              // Serialize with unit changes and the shared product cost writer. The
              // serializable transaction also detects concurrent price-book/stock writes.
              await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Product" WHERE "organizationId"=${input.organizationId}
            AND "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
              const p = await plan(tx, { ...input, receiving });
              if (p.state !== token.state) throw stale();
              const result = await postStockReceivingTx(tx, {
                ...receiving,
                date: receiving.date ? new Date(receiving.date) : undefined,
                actorId: input.actorId,
                organizationId: input.organizationId,
                requestId: input.requestId,
                idempotencyKey: input.idempotencyKey,
              });
              for (const line of receiving.lines) {
                const preview = p.lines.find(
                  (l) => l.productId === line.productId && l.variantId === line.variantId,
                )!;
                if (!preview.changesSalePrice) continue;
                const key = {
                  organizationId: input.organizationId,
                  storeId: receiving.storeId,
                  productId: line.productId,
                  variantKey: line.variantId ?? "BASE",
                };
                const before = await tx.storePrice.findUnique({
                  where: { organizationId_storeId_productId_variantKey: key },
                });
                if (p.retailWholesaleEnabled) {
                  await saveProductPriceTypes(tx, {
                    ...key,
                    actorId: input.actorId,
                    requestId: input.requestId,
                    prices: [
                      {
                        variantId: line.variantId ?? undefined,
                        retailPriceKgs: line.salePriceKgs!,
                      },
                    ],
                    audit: false,
                  });
                } else {
                  await tx.storePrice.upsert({
                    where: { organizationId_storeId_productId_variantKey: key },
                    create: {
                      ...key,
                      variantId: line.variantId,
                      priceKgs: line.salePriceKgs!,
                      updatedById: input.actorId,
                    },
                    update: { priceKgs: line.salePriceKgs!, updatedById: input.actorId },
                  });
                  await syncExistingRetailPrice(tx, {
                    ...key,
                    priceKgs: line.salePriceKgs!,
                    actorId: input.actorId,
                  });
                }
                await writeAuditLog(tx, {
                  organizationId: input.organizationId,
                  actorId: input.actorId,
                  requestId: input.requestId,
                  action: "RECEIVING_SALE_PRICE_UPDATE",
                  entity: "StorePrice",
                  entityId: line.productId,
                  before: toJson({ currentPriceKgs: preview.currentSalePriceKgs, row: before }),
                  after: toJson({
                    storeId: receiving.storeId,
                    variantId: line.variantId,
                    priceKgs: line.salePriceKgs,
                    receivingId: result.receivingId,
                  }),
                });
              }
              await writeAuditLog(tx, {
                organizationId: input.organizationId,
                actorId: input.actorId,
                requestId: input.requestId,
                action: "RECEIVING_COMMERCE_POST",
                entity: "StockMovement",
                entityId: result.receivingId,
                before: null,
                after: toJson({
                  storeId: receiving.storeId,
                  receivingId: result.receivingId,
                  reviewedValuation: p.lines.map((l) => ({
                    productId: l.productId,
                    variantId: l.variantId,
                    valuation: l.valuation,
                    changesSalePrice: l.changesSalePrice,
                  })),
                }),
              });
              return { status: "POSTED", result };
            },
          );
          if (!claimed.replayed && claimed.result.status === "POSTED")
            published = claimed.result.result;
          return claimed.result;
        },
        { isolationLevel: "Serializable", maxWait: 10_000, timeout: 60_000 },
      );
      if (published) {
        await publishStockReceivingResult(
          { storeId: receiving.storeId, requestId: input.requestId },
          published,
        ).catch((error) =>
          getLogger(input.requestId).warn({ error }, "receiving committed; notification failed"),
        );
        await Promise.all(
          [
            ...new Set(
              receiving.lines.filter((l) => l.salePriceKgs !== undefined).map((l) => l.productId),
            ),
          ].map((productId) =>
            publishProductChange(input.organizationId, productId, [receiving.storeId]),
          ),
        );
      }
      return receipt;
    } catch (error) {
      published = null;
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        !["P2034", "P2002"].includes(error.code) ||
        attempt >= 2
      )
        throw error;
    }
  }
}
export async function postReviewedStockReceiving(input: ApplyInput): Promise<StockReceivingResult> {
  const result = await run(input, false);
  if (result.status === "CANCELED") throw new AppError("receivingAttemptCanceled", "CONFLICT", 409);
  return result.result;
}
export const reconcileStockReceivingAttempt = (input: ApplyInput) => run(input, true);
