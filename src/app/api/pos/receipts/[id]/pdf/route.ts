import { cookies } from "next/headers";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getServerAuthToken } from "@/server/auth/token";
import { defaultLocale, normalizeLocale, toIntlLocale } from "@/lib/locales";
import { getMessageFromFallback } from "@/lib/i18nFallback";
import { buildPosReceiptPdf } from "@/server/services/posReceiptPdf";
import { AppError } from "@/server/services/errors";
import {
  buildReceiptPrintPayload,
} from "@/server/services/receiptPrintPayload";
import type { ReceiptPrintVariant } from "@/server/printing/types";

export const runtime = "nodejs";

type MessageTree = Record<string, unknown>;

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

const resolveVariant = (request: Request): ReceiptPrintVariant | null => {
  const kind = new URL(request.url).searchParams.get("kind");
  if (!kind || kind === "precheck") {
    return "PRECHECK";
  }
  if (kind === "fiscal") {
    return "FISCAL";
  }
  return null;
};

export const GET = async (request: Request, { params }: { params: { id: string } }) => {
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

  const variant = resolveVariant(request);
  if (!variant) {
    return new Response(tErrors("invalidInput"), { status: 400 });
  }

  try {
    const job = await buildReceiptPrintPayload({
      organizationId: token.organizationId as string,
      saleId: params.id,
      locale: toIntlLocale(locale),
      variant,
      paymentMethodLabels: {
        CASH: tPos("payments.cash"),
        CARD: tPos("payments.card"),
        TRANSFER: tPos("payments.transfer"),
        OTHER: tPos("payments.other"),
      },
    });

    const pdf = await buildPosReceiptPdf({
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

    const variantSuffix = variant === "FISCAL" ? "fiscal" : "precheck";
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename=pos-receipt-${job.number}-${variantSuffix}.pdf`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return new Response(tErrors(error.message), { status: error.status });
    }
    return new Response(tErrors("unexpectedError"), { status: 500 });
  }
};
