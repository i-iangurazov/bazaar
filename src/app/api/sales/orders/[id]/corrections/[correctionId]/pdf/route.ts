import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cookies } from "next/headers";

import { defaultLocale, normalizeLocale } from "@/lib/locales";
import { getMessageFromFallback } from "@/lib/i18nFallback";
import { getServerAuthToken } from "@/server/auth/token";
import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";
import { assertUserCanAccessStore, type StoreAccessUser } from "@/server/services/storeAccess";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import {
  buildSalesCorrectionPdf,
  type SalesCorrectionPdfLabels,
} from "@/server/services/salesDocumentPdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noCache = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

type MessageTree = Record<string, unknown>;
const message = (messages: MessageTree, path: string) => {
  let value: unknown = messages;
  for (const key of path.split(".")) {
    value = value && typeof value === "object" ? (value as MessageTree)[key] : undefined;
  }
  return typeof value === "string" ? value : getMessageFromFallback(path) ?? path;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; correctionId: string }> },
) {
  const locale = normalizeLocale((await cookies()).get("NEXT_LOCALE")?.value) ?? defaultLocale;
  let messages: MessageTree = {};
  try {
    messages = JSON.parse(
      await readFile(join(process.cwd(), "messages", `${locale}.json`), "utf8"),
    ) as MessageTree;
  } catch {
    /* The fallback labels remain available. */
  }
  const errorResponse = (key: string, status: number) =>
    new Response(message(messages, `errors.${key}`), { status, headers: noCache });

  const token = await getServerAuthToken();
  if (!token?.sub || typeof token.organizationId !== "string") {
    return errorResponse("unauthorized", 401);
  }

  try {
    const { id, correctionId } = await params;
    const correction = await prisma.salesOrderCorrection.findFirst({
      where: { id: correctionId, originalOrderId: id, organizationId: token.organizationId },
      include: {
        originalOrder: {
          select: {
            number: true,
            createdAt: true,
            customerName: true,
            currencyCode: true,
            currencyRateKgsPerUnit: true,
            store: {
              select: {
                name: true,
                legalName: true,
                inn: true,
                currencyCode: true,
                currencyRateKgsPerUnit: true,
              },
            },
          },
        },
        saleReturn: {
          include: {
            lines: {
              include: { product: { select: { name: true, sku: true } } },
              orderBy: { id: "asc" },
            },
            refundRequests: {
              select: { status: true },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
        additionOrder: {
          include: {
            lines: {
              include: { product: { select: { name: true, sku: true } } },
              orderBy: { id: "asc" },
            },
          },
        },
      },
    });
    if (!correction) return errorResponse("salesCorrectionNotFound", 404);
    const user = await prisma.user.findFirst({
      where: {
        id: token.sub,
        organizationId: token.organizationId,
        isActive: true,
      },
      select: { id: true, organizationId: true, role: true, isOrgOwner: true },
    });
    if (!user?.organizationId) return errorResponse("unauthorized", 401);
    await assertFeatureEnabled({
      organizationId: token.organizationId,
      feature: "customerOrders",
    });
    await assertUserCanAccessStore(prisma, user as StoreAccessUser, correction.storeId);

    const t = (key: string) => message(messages, `salesDocuments.correctionPdf.${key}`);
    const labels: SalesCorrectionPdfLabels = {
      title: t("title"),
      number: t("number"),
      date: t("date"),
      original: t("original"),
      reason: t("reason"),
      notes: t("notes"),
      store: t("store"),
      customer: t("customer"),
      seller: t("seller"),
      inn: t("inn"),
      returnedTitle: t("returnedTitle"),
      addedTitle: t("addedTitle"),
      product: t("product"),
      sku: t("sku"),
      quantity: t("quantity"),
      price: t("price"),
      amount: t("amount"),
      returnedTotal: t("returnedTotal"),
      addedTotal: t("addedTotal"),
      offsetSettled: t("offsetSettled"),
      difference: t("difference"),
      toRefund: t("toRefund"),
      toRefundPending: t("toRefundPending"),
      toRefundPaid: t("toRefundPaid"),
      refundCanceled: t("refundCanceled"),
      toPay: t("toPay"),
      noDifference: t("noDifference"),
      empty: t("empty"),
      issuedBy: t("issuedBy"),
      receivedBy: t("receivedBy"),
      nonFiscal: t("nonFiscal"),
      page: t("page"),
    };
    const pdf = await buildSalesCorrectionPdf({
      job: {
        correctionNumber: correction.number,
        createdAt: correction.createdAt,
        reason: correction.reason,
        notes: correction.notes,
        originalNumber: correction.originalOrder.number,
        originalCreatedAt: correction.originalOrder.createdAt,
        storeName: correction.originalOrder.store.name,
        customerName: correction.originalOrder.customerName ?? "",
        sellerName: correction.originalOrder.store.legalName ?? correction.originalOrder.store.name,
        sellerInn: correction.originalOrder.store.inn,
        returnedKgs: Number(correction.returnedKgs),
        addedKgs: Number(correction.addedKgs),
        offsetKgs: Number(correction.offsetKgs),
        refundKgs: Number(correction.refundKgs),
        chargeKgs: Number(correction.chargeKgs),
        refundRequestStatus: correction.saleReturn?.refundRequests?.[0]?.status ?? null,
        returnedItems: (correction.saleReturn?.lines ?? []).map((line) => ({
          name: line.product.name,
          sku: line.product.sku,
          qty: line.qty,
          unitPriceKgs: Number(line.unitPriceKgs),
          lineTotalKgs: Number(line.lineTotalKgs),
        })),
        addedItems: (correction.additionOrder?.lines ?? []).map((line) => ({
          name: line.product.name,
          sku: line.product.sku,
          qty: line.qty,
          unitPriceKgs: Number(line.unitPriceKgs),
          lineTotalKgs: Number(line.lineTotalKgs),
        })),
        currencyCode:
          correction.originalOrder.currencyCode ?? correction.originalOrder.store.currencyCode,
        currencyRateKgsPerUnit: Number(
          correction.originalOrder.currencyRateKgsPerUnit ??
            correction.originalOrder.store.currencyRateKgsPerUnit,
        ),
      },
      locale,
      labels,
    });
    try {
      await writeAuditLog(prisma, {
        organizationId: token.organizationId,
        actorId: token.sub,
        action: "SALES_CORRECTION_DOCUMENT_DOWNLOAD",
        entity: "SalesOrderCorrection",
        entityId: correction.id,
        before: null,
        after: toJson({ number: correction.number, source: "pdf" }),
        requestId: request.headers.get("x-request-id") ?? randomUUID(),
      });
    } catch {
      /* A read-only document must not fail because audit is unavailable. */
    }
    const safeNumber = correction.number.replace(/[^\p{L}\p{N}_.-]/gu, "-").slice(0, 120);
    return new Response(new Uint8Array(pdf), {
      headers: {
        ...noCache,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="correction-${safeNumber}.pdf"`,
      },
    });
  } catch (error) {
    if (error instanceof AppError) return errorResponse(error.message, error.status);
    return errorResponse("unexpectedError", 500);
  }
}
