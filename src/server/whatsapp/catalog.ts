import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { catalogVariantLabel } from "@/lib/catalogVariantLabel";
import { findRankedProductIds } from "@/server/services/products/searchSql";
import { getEffectiveProductPrice } from "@/server/services/effectiveProductPrice";
import { resolveStoreSellingPrice } from "@/server/services/storeSellingPrice";
import { catalogVisibilityWhere } from "@/server/services/catalogVisibility";

export const whatsappSearchSchema = z
  .object({
    query: z.string().trim().min(1).max(150),
    category: z.string().trim().max(100).optional(),
    attributes: z.array(z.string().trim().min(1).max(60)).max(5).default([]),
  })
  .strict();
export type WhatsAppOffer = {
  ref: string;
  productId: string;
  variantId: string | null;
  name: string;
  variant: string | null;
  price: string | null;
  currency: "KGS";
  available: boolean;
  quantity: number | null;
  unit: string;
  link: string | null;
  image: string | null;
};

/** Public projection only. Never reuse staff/global search or expose purchase cost. */
export async function whatsappSearch(
  organizationId: string,
  storeId: string,
  raw: unknown,
  desiredRefs?: string[],
): Promise<WhatsAppOffer[]> {
  const input = whatsappSearchSchema.parse(raw);
  const store = await prisma.store.findFirstOrThrow({
    where: { id: storeId, organizationId },
    select: { currencyCode: true, retailWholesaleEnabled: true },
  });
  if (store.currencyCode !== "KGS") return [];
  const ids = await findRankedProductIds({
    prisma,
    organizationId,
    storeIds: [storeId],
    query: input.query,
    limit: 30,
    matchTokensAcrossFields: true,
  });
  if (!ids.length) return [];
  const catalog = await prisma.bazaarCatalog.findFirst({
    where: { organizationId, storeId },
    select: { status: true, publicUrlPath: true },
  });
  const products = await prisma.product.findMany({
    where: {
      organizationId,
      id: { in: ids },
      isDeleted: false,
      storeProducts: { some: { storeId, organizationId, isActive: true, isHidden: false } },
      hiddenInBazaarCatalogs: { none: { storeId } },
      ...(input.category
        ? {
            OR: [
              { category: { contains: input.category, mode: "insensitive" } },
              { categories: { has: input.category } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      unit: true,
      basePriceKgs: true,
      isBundle: true,
      photoUrl: true,
      images: { orderBy: { position: "asc" }, take: 1, select: { url: true } },
      _count: { select: { variants: { where: { isActive: true } } } },
      variants: {
        where: {
          isActive: true,
          ...(desiredRefs ? { id: { in: desiredRefs.map((ref) => ref.split(":")[1]) } } : {}),
        },
        take: 100,
        orderBy: { id: "asc" },
        select: { id: true, name: true, attributes: true, image: { select: { url: true } } },
      },
      storePrices: {
        where: { storeId, organizationId },
        select: {
          variantKey: true,
          priceKgs: true,
          retailPriceKgs: true,
          wholesalePriceKgs: true,
          discountType: true,
          discountPercentage: true,
          discountStartsAt: true,
          discountEndsAt: true,
        },
      },
      inventorySnapshots: { where: { storeId }, select: { variantKey: true, onHand: true } },
    },
  });
  const bundleAvailable = products.some((p) => p.isBundle)
    ? new Set(
        (
          await prisma.product.findMany({
            where: {
              organizationId,
              id: { in: products.filter((p) => p.isBundle).map((p) => p.id) },
              AND: await catalogVisibilityWhere(prisma, {
                organizationId,
                storeId,
                hideOutOfStock: true,
                hideWithoutPhoto: false,
              }),
            },
            select: { id: true },
          })
        ).map((p) => p.id),
      )
    : new Set<string>();
  const offers: WhatsAppOffer[] = [];
  const ranked = new Map(ids.map((id, i) => [id, i]));
  products.sort((a, b) => ranked.get(a.id)! - ranked.get(b.id)!);
  for (const p of products) {
    const variants = p.variants.length ? p.variants : p._count.variants ? [] : [null];
    for (const [index, v] of variants.entries()) {
      const label = v ? catalogVariantLabel(v, index) : null;
      const haystack =
        `${p.name} ${label ?? ""} ${JSON.stringify(v?.attributes ?? {})}`.toLocaleLowerCase();
      if (!input.attributes.every((a) => haystack.includes(a.toLocaleLowerCase()))) continue;
      const row =
        p.storePrices.find((r) => r.variantKey === (v?.id ?? "BASE")) ??
        p.storePrices.find((r) => r.variantKey === "BASE");
      const price = resolveStoreSellingPrice({
        enabled: store.retailWholesaleEnabled,
        mode: "RETAIL",
        standard: row?.priceKgs ?? p.basePriceKgs,
        retail: row?.retailPriceKgs,
        wholesale: row?.wholesalePriceKgs,
      }).price;
      const effective =
        price !== null
          ? getEffectiveProductPrice({
              basePrice: price,
              currency: "KGS",
              now: new Date(),
              discount:
                row?.discountType === "PERCENTAGE" && row.discountPercentage
                  ? {
                      type: "PERCENTAGE",
                      percentage: row.discountPercentage,
                      startsAt: row.discountStartsAt,
                      endsAt: row.discountEndsAt,
                    }
                  : null,
            })
          : null;
      const quantity = p.isBundle
        ? null
        : Math.max(
            0,
            p.inventorySnapshots.find((s) => s.variantKey === (v?.id ?? "BASE"))?.onHand ?? 0,
          );
      const image = v?.image?.url ?? p.images[0]?.url ?? p.photoUrl;
      offers.push({
        ref: `${p.id}:${v?.id ?? "BASE"}`,
        productId: p.id,
        variantId: v?.id ?? null,
        name: p.name,
        variant: label,
        price: effective?.effectivePrice.toFixed(2) ?? null,
        currency: "KGS",
        available: p.isBundle ? bundleAvailable.has(p.id) : Boolean(quantity && quantity > 0),
        quantity,
        unit: p.unit,
        link:
          catalog?.status === "PUBLISHED"
            ? `${catalog.publicUrlPath}?product=${encodeURIComponent(p.id)}`
            : null,
        image: image && (/^https:\/\//.test(image) || /^\/(?!\/)/.test(image)) ? image : null,
      });
      if (offers.length >= 5) return offers;
    }
  }
  return offers;
}

export async function refreshWhatsAppOffers(
  organizationId: string,
  storeId: string,
  refs: string[],
) {
  if (refs.length > 5) throw new Error("Too many WhatsApp offers");
  if (!refs.length) return [];
  const ids = [...new Set(refs.map((ref) => ref.split(":")[0]))];
  const products = await prisma.product.findMany({
    where: { organizationId, id: { in: ids }, isDeleted: false },
    select: { id: true, sku: true },
  });
  const fresh: WhatsAppOffer[] = [];
  for (const product of products) {
    const values = await whatsappSearch(organizationId, storeId, { query: product.sku }, refs);
    fresh.push(...values.filter((v) => refs.includes(v.ref)));
  }
  return fresh;
}

// Keep domain arithmetic in the existing Decimal implementation.
export const whatsappMoney = (value: string) => new Prisma.Decimal(value).toFixed(2);
