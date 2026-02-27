import { cookies } from "next/headers";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { printReceipt } from "@/server/printing/adapter";
import { getServerAuthToken } from "@/server/auth/token";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { defaultLocale, normalizeLocale, toIntlLocale } from "@/lib/locales";
import { getMessageFromFallback } from "@/lib/i18nFallback";
import { PrinterPrintMode } from "@prisma/client";
import { buildReceiptPrintPayload } from "@/server/services/receiptPrintPayload";

export const runtime = "nodejs";

type MessageTree = Record<string, unknown>;

const requestSchema = z.object({
  saleId: z.string().min(1),
  kind: z.enum(["precheck", "fiscal"]).optional(),
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
  const tPos = createTranslator(messages, "pos");

  const token = await getServerAuthToken();
  if (!token) {
    return new Response(tErrors("unauthorized"), { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(tErrors("invalidInput"), { status: 400 });
  }

  const sale = await prisma.customerOrder.findFirst({
    where: {
      id: parsed.data.saleId,
      organizationId: token.organizationId as string,
      isPosSale: true,
    },
    select: {
      id: true,
      storeId: true,
    },
  });

  if (!sale) {
    return new Response(tErrors("posSaleNotFound"), { status: 404 });
  }

  const settings = await prisma.storePrinterSettings.findUnique({
    where: { storeId: sale.storeId },
    select: { receiptPrintMode: true },
  });
  const mode = settings?.receiptPrintMode ?? PrinterPrintMode.PDF;
  if (mode !== PrinterPrintMode.CONNECTOR) {
    return new Response(tErrors("printerConnectorModeRequired"), { status: 409 });
  }

  try {
    const variant = parsed.data.kind === "fiscal" ? "FISCAL" : "PRECHECK";
    const job = await buildReceiptPrintPayload({
      organizationId: token.organizationId as string,
      saleId: sale.id,
      locale: toIntlLocale(locale),
      variant,
      paymentMethodLabels: {
        CASH: tPos("payments.cash"),
        CARD: tPos("payments.card"),
        TRANSFER: tPos("payments.transfer"),
        OTHER: tPos("payments.other"),
      },
    });

    await printReceipt({
      organizationId: token.organizationId as string,
      job,
      labels: {
        title: tPos("receiptPdf.title"),
        precheckTitle: tPos("receiptPdf.precheckTitle"),
        precheckHint: tPos("receiptPdf.precheckHint"),
        fiscalBlockTitle: tPos("receiptPdf.fiscalBlockTitle"),
        fiscalStatus: tPos("receiptPdf.fiscalStatus"),
        fiscalStatusSent: tPos("receiptPdf.fiscalStatusSent"),
        fiscalStatusNotSent: tPos("receiptPdf.fiscalStatusNotSent"),
        fiscalStatusFailed: tPos("receiptPdf.fiscalStatusFailed"),
        fiscalRetryHint: tPos("receiptPdf.fiscalRetryHint"),
        fiscalizedAt: tPos("receiptPdf.fiscalizedAt"),
        kkmFactoryNumber: tPos("receiptPdf.kkmFactoryNumber"),
        kkmRegistrationNumber: tPos("receiptPdf.kkmRegistrationNumber"),
        fiscalNumber: tPos("receiptPdf.fiscalNumber"),
        upfdOrFiscalMemory: tPos("receiptPdf.upfdOrFiscalMemory"),
        qrPayload: tPos("receiptPdf.qrPayload"),
        saleNumber: tPos("receiptPdf.saleNumber"),
        createdAt: tPos("receiptPdf.createdAt"),
        register: tPos("receiptPdf.register"),
        cashier: tPos("receiptPdf.cashier"),
        shift: tPos("receiptPdf.shift"),
        inn: tPos("receiptPdf.inn"),
        address: tPos("receiptPdf.address"),
        phone: tPos("receiptPdf.phone"),
        qty: tPos("receiptPdf.qty"),
        subtotal: tPos("receiptPdf.subtotal"),
        total: tPos("receiptPdf.total"),
        payments: tPos("receiptPdf.payments"),
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
