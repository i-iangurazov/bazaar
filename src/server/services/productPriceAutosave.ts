import { normalizeCurrencyCode, normalizeCurrencyRateKgsPerUnit } from "@/lib/currency";
import { Prisma } from "@prisma/client";
import {
  productPriceAutosaveSchema,
  type ProductPriceAutosaveRequest,
  type ProductPricePatch,
} from "@/lib/productPriceAutosave";
import { prisma } from "@/server/db/prisma";
import { AppError } from "./errors";
import { assertUserCanAccessStore } from "./storeAccess";
import { assertUserCanAccessProduct } from "./productAccess";
import { assertTrialActive } from "./planLimits";
import { productPriceVersion, readProductPriceVersion } from "./productPriceVersion";
import { resolveProductFormRetailPrice } from "./productFormPricing";
import { saveProductPriceTypes } from "./productPriceTypes";
import { withIdempotency } from "./idempotency";
import { writeAuditLog } from "./audit";
import { toJson } from "./json";
import { publishProductChange } from "./productChangeEvents";
import { eventBus } from "@/server/events/eventBus";
import { getLogger } from "@/server/logging";
type Tx = Prisma.TransactionClient;
type Principal = { organizationId: string; actorId: string; requestId: string };
type Input = Principal & { change: ProductPriceAutosaveRequest };
type Receipt =
  | {
      status: "SAVED";
      version: string;
      prices: ProductPricePatch[];
      stored: Array<{
        variantId: string | null;
        overridePriceKgs: number | null;
        retailPriceKgs: number | null;
        wholesalePriceKgs: number | null;
      }>;
      changed: boolean;
    }
  | { status: "CANCELED" };
const normalized = (change: ProductPriceAutosaveRequest) => {
  const c = productPriceAutosaveSchema.parse(change);
  return {
    ...c,
    prices: c.prices
      .map((p) => ({ ...p, variantId: p.variantId ?? null }))
      .sort((a, b) => (a.variantId ?? "BASE").localeCompare(b.variantId ?? "BASE")),
  };
};
async function authorize(tx: Tx, input: Input) {
  const actor = await tx.user.findFirst({
    where: { id: input.actorId, organizationId: input.organizationId, isActive: true },
  });
  if (!actor || !["ADMIN", "MANAGER"].includes(actor.role))
    throw new AppError("forbidden", "FORBIDDEN", 403);
  const user = { ...actor, organizationId: input.organizationId };
  await assertUserCanAccessStore(tx, user, input.change.storeId);
  await assertUserCanAccessProduct(tx, user, input.change.productId, {
    writable: true,
    allowShared: true,
  });
  const org = await assertTrialActive(input.organizationId, tx);
  if (!org.entitlements.features.storePrices)
    throw new AppError("featureLockedStorePrices", "FORBIDDEN", 403);
  const assignment = await tx.storeProduct.findFirst({
    where: {
      organizationId: input.organizationId,
      storeId: input.change.storeId,
      productId: input.change.productId,
      isActive: true,
      isHidden: false,
    },
  });
  if (!assignment) throw new AppError("productNotAvailableInStore", "FORBIDDEN", 403);
}
async function run(input: Input, reconcile: boolean) {
  const c = normalized(input.change);
  for (let attempt = 0; ; attempt++) {
    try {
      const receipt = await prisma.$transaction(
        async (tx) => {
          await authorize(tx, input);
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`price-autosave:${input.organizationId}:${c.storeId}:${c.productId}`},0))`;
          return (
            await withIdempotency<Receipt>(
              tx,
              {
                key: c.idempotencyKey,
                route: "storePrices.autosave",
                userId: input.actorId,
                request: toJson({ organizationId: input.organizationId, change: c }),
              },
              async () => {
                if (reconcile) return { status: "CANCELED" };
                const org = await tx.organization.findUniqueOrThrow({
                  where: { id: input.organizationId },
                  select: { retailWholesaleEnabled: true },
                });
                if (!org.retailWholesaleEnabled)
                  throw new AppError("retailWholesaleDisabled", "CONFLICT", 409);
                if (
                  c.expectedVersion !==
                  (await readProductPriceVersion(tx, input.organizationId, c.storeId, c.productId))
                )
                  throw new AppError("priceAutosaveConflict", "CONFLICT", 409);
                const variants = c.prices.flatMap((p) => (p.variantId ? [p.variantId] : []));
                if (
                  variants.length !==
                  (await tx.productVariant.count({
                    where: { id: { in: variants }, productId: c.productId, isActive: true },
                  }))
                )
                  throw new AppError("variantMismatch", "BAD_REQUEST", 400);
                const store = await tx.store.findUniqueOrThrow({
                  where: { id: c.storeId },
                  select: { currencyCode: true, currencyRateKgsPerUnit: true },
                });
                const productUnit = await tx.product.findUniqueOrThrow({
                  where: { id: c.productId },
                  select: { baseUnitId: true },
                });
                if (
                  c.unitId !== productUnit.baseUnitId ||
                  c.currencyCode !== normalizeCurrencyCode(store.currencyCode) ||
                  c.currencyRateKgsPerUnit !==
                    normalizeCurrencyRateKgsPerUnit(
                      Number(store.currencyRateKgsPerUnit),
                      normalizeCurrencyCode(store.currencyCode),
                    )
                )
                  throw new AppError("priceAutosaveConflict", "CONFLICT", 409);
                const base = c.prices.find((p) => !p.variantId);
                await resolveProductFormRetailPrice(tx, {
                  organizationId: input.organizationId,
                  storeId: c.storeId,
                  productId: c.productId,
                  retailPriceKgs: base?.retailPriceKgs,
                });
                const where = {
                  organizationId: input.organizationId,
                  storeId: c.storeId,
                  productId: c.productId,
                };
                const [standards, extras, product] = await Promise.all([
                  tx.storePrice.findMany({ where }),
                  tx.storePriceTypes.findMany({ where }),
                  tx.product.findUniqueOrThrow({
                    where: { id: c.productId },
                    select: { basePriceKgs: true },
                  }),
                ]);
                const patches: ProductPricePatch[] = [];
                const result: ProductPricePatch[] = [];
                for (const price of c.prices) {
                  const k = price.variantId ?? "BASE",
                    s = standards.find((p) => p.variantKey === k),
                    e = extras.find((p) => p.variantKey === k);
                  const before = {
                    retailPriceKgs:
                      e?.retailPriceKgs?.toNumber() ??
                      s?.priceKgs.toNumber() ??
                      (!price.variantId ? product.basePriceKgs?.toNumber() : null) ??
                      null,
                    wholesalePriceKgs: e?.wholesalePriceKgs?.toNumber() ?? null,
                  };
                  const patch: ProductPricePatch = { variantId: price.variantId };
                  const values: ProductPricePatch = { variantId: price.variantId };
                  for (const kind of ["retailPriceKgs", "wholesalePriceKgs"] as const) {
                    if (price[kind] === undefined) continue;
                    const value =
                      price[kind] === null
                        ? null
                        : new Prisma.Decimal(price[kind]!).toDecimalPlaces(2).toNumber();
                    values[kind] = value;
                    if (value !== before[kind]) patch[kind] = value;
                  }
                  if (patch.retailPriceKgs !== undefined || patch.wholesalePriceKgs !== undefined)
                    patches.push(patch);
                  result.push(values);
                }
                for (const patch of patches)
                  if (patch.variantId && patch.retailPriceKgs === null)
                    await tx.storePrice.deleteMany({
                      where: { ...where, variantKey: patch.variantId },
                    });
                await saveProductPriceTypes(tx, {
                  ...where,
                  actorId: input.actorId,
                  requestId: input.requestId,
                  prices: patches.map((p) => ({ ...p, variantId: p.variantId ?? undefined })),
                  audit: false,
                });
                if (patches.length)
                  await writeAuditLog(tx, {
                    organizationId: input.organizationId,
                    actorId: input.actorId,
                    requestId: input.requestId,
                    action: "PRODUCT_PRICE_AUTOSAVE",
                    entity: "StorePrice",
                    entityId: c.productId,
                    before: toJson({ standard: standards, extras }),
                    after: toJson({ storeId: c.storeId, prices: patches }),
                  });
                const [afterStandard, afterExtra] = await Promise.all([
                  tx.storePrice.findMany({ where }),
                  tx.storePriceTypes.findMany({ where }),
                ]);
                const stored = c.prices.map((p) => {
                  const key = p.variantId ?? "BASE",
                    s = afterStandard.find((r) => r.variantKey === key),
                    e = afterExtra.find((r) => r.variantKey === key);
                  return {
                    variantId: p.variantId ?? null,
                    overridePriceKgs: s?.priceKgs.toNumber() ?? null,
                    retailPriceKgs: e?.retailPriceKgs?.toNumber() ?? null,
                    wholesalePriceKgs: e?.wholesalePriceKgs?.toNumber() ?? null,
                  };
                });
                return {
                  status: "SAVED",
                  version: productPriceVersion(afterStandard, afterExtra),
                  prices: result,
                  stored,
                  changed: patches.length > 0,
                };
              },
            )
          ).result;
        },
        { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 },
      );
      return receipt;
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
export async function autosaveProductPrices(input: Input) {
  const receipt = await run(input, false);
  if (receipt.status === "CANCELED")
    throw new AppError("priceAutosaveAttemptClosed", "CONFLICT", 409);
  if (receipt.changed) {
    await publishProductChange(input.organizationId, input.change.productId, [
      input.change.storeId,
    ]);
    try {
      eventBus.publish({ type: "pricing.updated", payload: { storeId: input.change.storeId } });
    } catch {
      getLogger().warn(
        { storeId: input.change.storeId },
        "committed price autosave notification failed",
      );
    }
  }
  return receipt;
}
export const reconcileProductPriceAutosave = (input: Input) => run(input, true);
