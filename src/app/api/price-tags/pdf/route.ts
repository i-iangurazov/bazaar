import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { prisma } from "@/server/db/prisma";
import { getServerAuthToken } from "@/server/auth/token";
import { normalizeLocale, toIntlLocale, defaultLocale } from "@/lib/locales";
import { getMessageFromFallback } from "@/lib/i18nFallback";
import { cookies } from "next/headers";
import { recordFirstEvent } from "@/server/services/productEvents";
import { buildPriceTagsPdf, type PriceTagLabel } from "@/server/services/priceTagsPdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MessageTree = Record<string, unknown>;
type PriceTagItem = { productId: string; quantity: number };

const loadMessages = async (locale: string) => {
  const filepath = join(process.cwd(), "messages", `${locale}.json`);
  const raw = await readFile(filepath, "utf8");
  return JSON.parse(raw) as MessageTree;
};

const getMessageValue = (messages: MessageTree | undefined, path: string) => {
  if (!messages) {
    return undefined;
  }
  const parts = path.split(".");
  let current: unknown = messages;
  for (const part of parts) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
};

const getMessage = (messages: MessageTree | undefined, key: string) =>
  getMessageValue(messages, key) ?? getMessageFromFallback(key) ?? key;

const createTranslator = (messages: MessageTree | undefined, namespace?: string) => {
  if (!namespace) {
    return (key: string) => getMessage(messages, key);
  }
  return (key: string) => getMessage(messages, `${namespace}.${key}`);
};


export const POST = async (request: Request) => {
  const localeCookie = cookies().get("NEXT_LOCALE")?.value;
  const locale = normalizeLocale(localeCookie) ?? defaultLocale;
  let messages: MessageTree | undefined;
  try {
    messages = await loadMessages(locale);
  } catch {
    messages = undefined;
  }
  const tPriceTags = createTranslator(messages, "priceTags");
  const tErrors = createTranslator(messages, "errors");

  const token = await getServerAuthToken();
  if (!token) {
    return new Response(tErrors("unauthorized"), { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return new Response(tErrors("invalidInput"), { status: 400 });
  }

  const template = body.template as "3x8" | "2x5" | undefined;
  const items = Array.isArray(body.items) ? (body.items as PriceTagItem[]) : [];
  const storeId = typeof body.storeId === "string" && body.storeId ? body.storeId : null;

  if (!template || !["3x8", "2x5"].includes(template)) {
    return new Response(tErrors("invalidInput"), { status: 400 });
  }
  if (!items.length) {
    return new Response(tErrors("invalidInput"), { status: 400 });
  }

  const parsedItems: PriceTagItem[] = items
    .map((item: PriceTagItem) => ({
      productId: typeof item.productId === "string" ? item.productId : "",
      quantity: Number(item.quantity ?? 0),
    }))
    .filter(
      (item: PriceTagItem) =>
        item.productId && Number.isFinite(item.quantity) && item.quantity > 0,
    );

  if (!parsedItems.length) {
    return new Response(tErrors("invalidInput"), { status: 400 });
  }

  let storeName: string | null = null;
  if (storeId) {
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store || store.organizationId !== token.organizationId) {
      return new Response(tErrors("storeAccessDenied"), { status: 403 });
    }
    storeName = store.name;
  }

  const productIds = parsedItems.map((item: PriceTagItem) => item.productId);
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      organizationId: token.organizationId as string,
      isDeleted: false,
    },
    include: { barcodes: { select: { value: true } } },
  });

  const productMap = new Map(products.map((product) => [product.id, product]));
  const storePrices = storeId
    ? await prisma.storePrice.findMany({
        where: {
          organizationId: token.organizationId as string,
          storeId,
          productId: { in: products.map((product) => product.id) },
          variantKey: "BASE",
        },
        select: { productId: true, priceKgs: true },
      })
    : [];
  type StorePriceRow = { productId: string; priceKgs: unknown };
  const priceMap = new Map(
    storePrices.map((price: StorePriceRow) => [price.productId, price]),
  );

  const labels: PriceTagLabel[] = parsedItems.flatMap((item: PriceTagItem) => {
    const product = productMap.get(item.productId);
    if (!product) {
      return [] as PriceTagLabel[];
    }
    const basePrice = product.basePriceKgs ? Number(product.basePriceKgs) : null;
    const override = priceMap.get(product.id);
    const effectivePrice = override ? Number(override.priceKgs) : basePrice;
    const barcode = product.barcodes?.[0]?.value ?? "";
    const label = {
      name: product.name,
      sku: product.sku,
      barcode,
      price: effectivePrice,
    };
    return Array.from({ length: item.quantity }).map(() => label);
  });

  if (!labels.length) {
    return new Response(tErrors("invalidInput"), { status: 400 });
  }

  const pdf = await buildPriceTagsPdf({
    labels,
    template,
    locale: toIntlLocale(locale),
    storeName,
    noPriceLabel: tPriceTags("noPrice"),
    skuLabel: tPriceTags("sku"),
  });
  const response = new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=price-tags.pdf",
    },
  });

  await recordFirstEvent({
    organizationId: token.organizationId as string,
    actorId: token.sub ?? null,
    type: "first_price_tags_printed",
    metadata: { template, storeId, count: parsedItems.length },
  });

  return response;
};
