import type { PosPaymentMethod } from "@prisma/client";

import type { ReceiptPrintJob, ReceiptPrintVariant } from "@/server/printing/types";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { extractFiscalMetadata } from "@/server/services/fiscalReceiptMetadata";

const toMoney = (value: { toNumber?: () => number } | number | null | undefined) => {
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return 0;
};

export const buildReceiptPrintPayload = async (input: {
  organizationId: string;
  saleId: string;
  locale: string;
  paymentMethodLabels: Record<PosPaymentMethod, string>;
  variant?: ReceiptPrintVariant;
}): Promise<ReceiptPrintJob> => {
  const sale = await prisma.customerOrder.findFirst({
    where: {
      id: input.saleId,
      organizationId: input.organizationId,
      isPosSale: true,
    },
    include: {
      store: {
        select: {
          id: true,
          name: true,
          legalName: true,
          inn: true,
          address: true,
          phone: true,
        },
      },
      register: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
      shift: {
        select: {
          id: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
        },
      },
      lines: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
            },
          },
        },
        orderBy: { id: "asc" },
      },
      payments: {
        where: { isRefund: false },
        orderBy: { createdAt: "asc" },
      },
      fiscalReceipts: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          providerReceiptId: true,
          fiscalNumber: true,
          kkmFactoryNumber: true,
          kkmRegistrationNumber: true,
          fiscalModeStatus: true,
          upfdOrFiscalMemory: true,
          qrPayload: true,
          qr: true,
          fiscalizedAt: true,
          sentAt: true,
          lastError: true,
        },
      },
    },
  });

  if (!sale) {
    throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
  }

  const fiscalReceipt = sale.fiscalReceipts[0] ?? null;
  const rawFiscal = extractFiscalMetadata(sale.kkmRawJson);
  const modeStatus = fiscalReceipt?.fiscalModeStatus ?? sale.kkmStatus;
  const variant: ReceiptPrintVariant = input.variant ?? "PRECHECK";

  if (variant === "FISCAL" && modeStatus !== "SENT") {
    throw new AppError("posFiscalReceiptUnavailable", "CONFLICT", 409);
  }

  const fiscalizedAt = fiscalReceipt?.fiscalizedAt ?? fiscalReceipt?.sentAt ?? null;
  const qrPayload = fiscalReceipt?.qrPayload ?? fiscalReceipt?.qr ?? rawFiscal.qrPayload ?? null;

  return {
    saleId: sale.id,
    storeId: sale.storeId,
    locale: input.locale,
    variant,
    number: sale.number,
    createdAt: sale.completedAt ?? sale.createdAt,
    storeName: sale.store.name,
    legalName: sale.store.legalName ?? null,
    inn: sale.store.inn ?? null,
    address: sale.store.address ?? null,
    phone: sale.store.phone ?? null,
    registerName: sale.register ? `${sale.register.name} (${sale.register.code})` : null,
    cashierName: sale.createdBy?.name ?? null,
    shiftLabel: sale.shift?.id ?? null,
    items: sale.lines.map((line) => ({
      productId: line.productId,
      name: line.product.name,
      sku: line.product.sku,
      qty: line.qty,
      unitPriceKgs: toMoney(line.unitPriceKgs),
      lineTotalKgs: toMoney(line.lineTotalKgs),
    })),
    totals: {
      subtotalKgs: toMoney(sale.subtotalKgs),
      totalKgs: toMoney(sale.totalKgs),
      payments: sale.payments.map((payment) => ({
        method: payment.method,
        methodLabel: input.paymentMethodLabels[payment.method],
        amountKgs: toMoney(payment.amountKgs),
      })),
    },
    fiscal: {
      modeStatus,
      providerReceiptId: fiscalReceipt?.providerReceiptId ?? sale.kkmReceiptId ?? null,
      fiscalNumber: fiscalReceipt?.fiscalNumber ?? null,
      kkmFactoryNumber: fiscalReceipt?.kkmFactoryNumber ?? rawFiscal.kkmFactoryNumber ?? null,
      kkmRegistrationNumber:
        fiscalReceipt?.kkmRegistrationNumber ?? rawFiscal.kkmRegistrationNumber ?? null,
      upfdOrFiscalMemory:
        fiscalReceipt?.upfdOrFiscalMemory ?? rawFiscal.upfdOrFiscalMemory ?? null,
      qrPayload,
      fiscalizedAt,
      lastError: fiscalReceipt?.lastError ?? null,
    },
  };
};
