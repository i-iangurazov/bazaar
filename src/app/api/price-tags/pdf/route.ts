import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PrinterPrintMode } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { getServerAuthToken } from "@/server/auth/token";
import { normalizeLocale, toIntlLocale, defaultLocale } from "@/lib/locales";
import { getMessageFromFallback } from "@/lib/i18nFallback";
import { cookies } from "next/headers";
import { recordFirstEvent } from "@/server/services/productEvents";
import { buildPriceTagsPdf, type PriceTagLabel } from "@/server/services/priceTagsPdf";
import { selectPrimaryBarcodeValue } from "@/server/services/barcodes";
import { AppError } from "@/server/services/errors";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import {
  PRICE_TAG_ROLL_DEFAULTS,
  PRICE_TAG_ROLL_LIMITS,
  PRICE_TAG_TEMPLATES,
  ROLL_PRICE_TAG_TEMPLATE,
} from "@/lib/priceTags";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MessageTree = Record<string, unknown>;
type PriceTagItem = { productId: string; quantity: number };
const MAX_PRICE_TAG_QUANTITY_PER_ITEM = 100;
const MAX_PRICE_TAG_LABELS_TOTAL = 500;
const MAX_PRICE_TAG_REQUEST_ITEMS = MAX_PRICE_TAG_LABELS_TOTAL;

const priceTagRequestSchema = z
  .object({
    template: z.enum(PRICE_TAG_TEMPLATES),
    allowWithoutBarcode: z.boolean().optional(),
    rollCalibration: z
      .object({
        gapMm: z.coerce
          .number()
          .min(PRICE_TAG_ROLL_LIMITS.gapMm.min)
          .max(PRICE_TAG_ROLL_LIMITS.gapMm.max)
          .optional(),
        xOffsetMm: z.coerce
          .number()
          .min(PRICE_TAG_ROLL_LIMITS.offsetMm.min)
          .max(PRICE_TAG_ROLL_LIMITS.offsetMm.max)
          .optional(),
        yOffsetMm: z.coerce
          .number()
          .min(PRICE_TAG_ROLL_LIMITS.offsetMm.min)
          .max(PRICE_TAG_ROLL_LIMITS.offsetMm.max)
          .optional(),
        widthMm: z.coerce
          .number()
          .min(PRICE_TAG_ROLL_LIMITS.widthMm.min)
          .max(PRICE_TAG_ROLL_LIMITS.widthMm.max)
          .optional(),
        heightMm: z.coerce
          .number()
          .min(PRICE_TAG_ROLL_LIMITS.heightMm.min)
          .max(PRICE_TAG_ROLL_LIMITS.heightMm.max)
          .optional(),
      })
      .optional(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1).max(191),
          quantity: z.coerce.number().int().positive().max(MAX_PRICE_TAG_QUANTITY_PER_ITEM),
        }),
      )
      .min(1)
      .max(MAX_PRICE_TAG_REQUEST_ITEMS),
    storeId: z
      .union([z.string().min(1).max(191), z.null(), z.undefined()])
      .optional(),
  })
  .superRefine((value, ctx) => {
    const totalLabels = value.items.reduce((sum, item) => sum + item.quantity, 0);
    if (totalLabels > MAX_PRICE_TAG_LABELS_TOTAL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "labelsLimitExceeded",
        path: ["items"],
      });
    }
  });

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
  try {
    await assertFeatureEnabled({
      organizationId: token.organizationId as string,
      feature: "priceTags",
    });
  } catch (error) {
    if (error instanceof AppError) {
      const status = error.code === "FORBIDDEN" ? 403 : 400;
      return new Response(tErrors(error.message), { status });
    }
    return new Response(tErrors("genericMessage"), { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const parsed = priceTagRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(tErrors("invalidInput"), { status: 400 });
  }

  const template = parsed.data.template;
  const parsedItems = parsed.data.items as PriceTagItem[];
  const storeId = typeof parsed.data.storeId === "string" ? parsed.data.storeId : null;
  const allowWithoutBarcode = parsed.data.allowWithoutBarcode === true;
  const rollCalibration = {
    gapMm: parsed.data.rollCalibration?.gapMm ?? PRICE_TAG_ROLL_DEFAULTS.gapMm,
    xOffsetMm: parsed.data.rollCalibration?.xOffsetMm ?? PRICE_TAG_ROLL_DEFAULTS.xOffsetMm,
    yOffsetMm: parsed.data.rollCalibration?.yOffsetMm ?? PRICE_TAG_ROLL_DEFAULTS.yOffsetMm,
    widthMm: parsed.data.rollCalibration?.widthMm ?? PRICE_TAG_ROLL_DEFAULTS.widthMm,
    heightMm: parsed.data.rollCalibration?.heightMm ?? PRICE_TAG_ROLL_DEFAULTS.heightMm,
  };

  let storeName: string | null = null;
  if (storeId) {
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store || store.organizationId !== token.organizationId) {
      return new Response(tErrors("storeAccessDenied"), { status: 403 });
    }
    storeName = store.name;
  }

  const productIds = Array.from(new Set(parsedItems.map((item: PriceTagItem) => item.productId)));
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
    const barcode = selectPrimaryBarcodeValue(product.barcodes.map((entry) => entry.value));
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
  const missingBarcodeCount = labels.reduce((count, label) => (label.barcode.trim() ? count : count + 1), 0);
  if (template === ROLL_PRICE_TAG_TEMPLATE && missingBarcodeCount > 0 && !allowWithoutBarcode) {
    return new Response(tErrors("priceTagsBarcodeConfirmationRequired"), { status: 400 });
  }

  if (template === ROLL_PRICE_TAG_TEMPLATE && storeId) {
    await prisma.storePrinterSettings.upsert({
      where: { storeId },
      create: {
        organizationId: token.organizationId as string,
        storeId,
        receiptPrintMode: PrinterPrintMode.PDF,
        labelPrintMode: PrinterPrintMode.PDF,
        labelRollGapMm: rollCalibration.gapMm,
        labelRollXOffsetMm: rollCalibration.xOffsetMm,
        labelRollYOffsetMm: rollCalibration.yOffsetMm,
        updatedById: token.sub ?? null,
      },
      update: {
        labelRollGapMm: rollCalibration.gapMm,
        labelRollXOffsetMm: rollCalibration.xOffsetMm,
        labelRollYOffsetMm: rollCalibration.yOffsetMm,
        updatedById: token.sub ?? null,
      },
    });
  }

  const pdf = await buildPriceTagsPdf({
    labels,
    template,
    locale: toIntlLocale(locale),
    storeName,
    noPriceLabel: tPriceTags("noPrice"),
    noBarcodeLabel: tPriceTags("noBarcode"),
    skuLabel: tPriceTags("sku"),
    rollCalibration,
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
