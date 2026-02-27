import { cookies } from "next/headers";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { PrinterPrintMode } from "@prisma/client";

import { printLabels } from "@/server/printing/adapter";
import { getServerAuthToken } from "@/server/auth/token";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { defaultLocale, normalizeLocale, toIntlLocale } from "@/lib/locales";
import { getMessageFromFallback } from "@/lib/i18nFallback";
import { PRICE_TAG_TEMPLATES } from "@/lib/priceTags";

export const runtime = "nodejs";

type MessageTree = Record<string, unknown>;

const requestSchema = z.object({
  storeId: z.string().min(1),
  template: z.enum(PRICE_TAG_TEMPLATES),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().positive(),
      }),
    )
    .min(1)
    .max(200),
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

  const tErrors = createTranslator(messages, "errors");
  const tPriceTags = createTranslator(messages, "priceTags");

  const token = await getServerAuthToken();
  if (!token) {
    return new Response(tErrors("unauthorized"), { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(tErrors("invalidInput"), { status: 400 });
  }

  const store = await prisma.store.findFirst({
    where: {
      id: parsed.data.storeId,
      organizationId: token.organizationId as string,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!store) {
    return new Response(tErrors("storeNotFound"), { status: 404 });
  }

  const settings = await prisma.storePrinterSettings.findUnique({
    where: { storeId: parsed.data.storeId },
    select: { labelPrintMode: true },
  });
  const mode = settings?.labelPrintMode ?? PrinterPrintMode.PDF;
  if (mode !== PrinterPrintMode.CONNECTOR) {
    return new Response(tErrors("printerConnectorModeRequired"), { status: 409 });
  }

  const quantities = Object.fromEntries(parsed.data.items.map((item) => [item.productId, item.quantity]));

  try {
    await printLabels({
      organizationId: token.organizationId as string,
      job: {
        storeId: store.id,
        productIds: parsed.data.items.map((item) => item.productId),
        template: parsed.data.template,
        quantities,
        locale: toIntlLocale(locale),
        labels: [],
        storeName: store.name,
        noPriceLabel: tPriceTags("noPrice"),
        noBarcodeLabel: tPriceTags("noBarcode"),
        skuLabel: tPriceTags("sku"),
      },
    });

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError) {
      return new Response(tErrors(error.message), { status: error.status });
    }
    return new Response(tErrors("unexpectedError"), { status: 500 });
  }
};
