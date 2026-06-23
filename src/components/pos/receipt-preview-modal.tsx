"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { DownloadIcon, PrintIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { currencySourceWithFallback, formatKgsMoney } from "@/lib/currencyDisplay";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { downloadPdfBlob, fetchPdfBlob, printPdfBlob } from "@/lib/pdfClient";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type ReceiptPreviewModalProps = {
  saleId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const paymentMethods = ["CASH", "CARD", "TRANSFER", "OTHER"] as const;

export const ReceiptPreviewModal = ({ saleId, open, onOpenChange }: ReceiptPreviewModalProps) => {
  const t = useTranslations("pos.receiptPreview");
  const tCommon = useTranslations("common");
  const tPos = useTranslations("pos");
  const locale = useLocale();
  const { toast } = useToast();
  const [pdfAction, setPdfAction] = useState<"print" | "download" | null>(null);

  const saleQuery = trpc.pos.sales.get.useQuery(
    { saleId: saleId ?? "" },
    {
      enabled: open && Boolean(saleId),
      refetchOnWindowFocus: false,
    },
  );

  const sale = saleQuery.data;
  const currencySource = sale ? currencySourceWithFallback(sale, sale.store) : undefined;
  const payments = paymentMethods
    .map((method) => ({
      method,
      amount:
        sale?.payments
          .filter((payment) => payment.method === method && !payment.isRefund)
          .reduce((sum, payment) => sum + Number(payment.amountKgs ?? 0), 0) ?? 0,
    }))
    .filter((payment) => payment.amount > 0);
  const completedReturns = sale?.saleReturns.filter((saleReturn) => saleReturn.status === "COMPLETED") ?? [];
  const returnedTotalKgs = completedReturns.reduce(
    (sum, saleReturn) => sum + Number(saleReturn.totalKgs ?? 0),
    0,
  );

  const handlePdf = async (mode: "download" | "print") => {
    if (!sale || pdfAction) {
      return;
    }
    setPdfAction(mode);
    try {
      const blob = await fetchPdfBlob({
        url: `/api/pos/receipts/${sale.id}/pdf?kind=precheck&action=${mode === "print" ? "reprint" : "download"}`,
      });
      if (mode === "print") {
        const result = await printPdfBlob(blob);
        if (!result.autoPrintAttempted) {
          toast({ variant: "info", description: tPos("sell.receiptPrintFallback") });
        }
      } else {
        downloadPdfBlob(blob, `pos-receipt-${sale.number}-precheck.pdf`);
      }
    } catch {
      toast({ variant: "error", description: tPos("history.receiptPdfFailed") });
    } finally {
      setPdfAction(null);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={sale ? t("titleWithNumber", { number: sale.number }) : t("title")}
      subtitle={sale?.completedAt ? formatDateTime(sale.completedAt, locale) : undefined}
      className="max-w-5xl"
      bodyClassName="p-0"
      mobileSheet
      usePortal
    >
      {saleQuery.isLoading ? (
        <div className="flex min-h-[18rem] items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {tCommon("loading")}
        </div>
      ) : saleQuery.error ? (
        <div className="m-4 rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger sm:m-6">
          {t("loadFailed")}
        </div>
      ) : !sale ? (
        <div className="p-6 text-sm text-muted-foreground">{t("notFound")}</div>
      ) : (
        <div className="space-y-0">
          <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4 lg:p-6">
            <div>
              <p className="text-xs text-muted-foreground">{t("store")}</p>
              <p className="text-sm font-medium text-foreground">{sale.store.name}</p>
              <p className="text-xs text-muted-foreground">{sale.store.code}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("register")}</p>
              <p className="text-sm font-medium text-foreground">
                {sale.register?.name ?? sale.register?.code ?? tCommon("notAvailable")}
              </p>
              <p className="text-xs text-muted-foreground">
                {sale.shift ? t("shift", { id: sale.shift.id.slice(-6) }) : tCommon("notAvailable")}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("cashier")}</p>
              <p className="text-sm font-medium text-foreground">
                {sale.cashier?.name ?? sale.cashier?.email ?? t("unknownCashier")}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("customer")}</p>
              <p className="text-sm font-medium text-foreground">
                {sale.customerName ?? sale.customerPhone ?? tCommon("notAvailable")}
              </p>
            </div>
          </div>

          <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4 lg:p-6">
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{t("subtotal")}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatKgsMoney(sale.subtotalKgs, locale, currencySource)}
              </p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{t("discount")}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatKgsMoney(sale.discountKgs, locale, currencySource)}
              </p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{t("returns")}</p>
              <p
                className={cn(
                  "text-lg font-semibold",
                  returnedTotalKgs > 0 ? "text-warning" : "text-foreground",
                )}
              >
                {formatKgsMoney(returnedTotalKgs, locale, currencySource)}
              </p>
            </div>
            <div className="rounded-md border border-border bg-primary/10 p-3">
              <p className="text-xs text-muted-foreground">{t("total")}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatKgsMoney(sale.totalKgs, locale, currencySource)}
              </p>
            </div>
          </div>

          <div className="border-b border-border p-4 lg:p-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">{t("payments")}</h3>
              {payments.length ? (
                <span className="text-xs text-muted-foreground">
                  {t("paymentTotal", {
                    total: formatKgsMoney(
                      payments.reduce((sum, payment) => sum + payment.amount, 0),
                      locale,
                      currencySource,
                    ),
                  })}
                </span>
              ) : null}
            </div>
            {payments.length ? (
              <div className="flex flex-wrap gap-2">
                {payments.map((payment) => (
                  <Badge key={payment.method} variant="default" className="bg-background">
                    {tPos(`payments.${payment.method.toLowerCase()}`)}
                    <span className="font-semibold text-foreground">
                      {formatKgsMoney(payment.amount, locale, currencySource)}
                    </span>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{tCommon("notAvailable")}</p>
            )}
          </div>

          <div className="p-0">
            <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-6">
              <h3 className="text-sm font-semibold text-foreground">{t("products")}</h3>
              <span className="text-xs text-muted-foreground">
                {t("lineCount", { count: sale.lines.length })}
              </span>
            </div>
            <div className="overflow-x-auto">
              <Table className="min-w-[760px]" sortable={false}>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="px-4 py-3 lg:px-6">{t("columns.product")}</TableHead>
                    <TableHead className="px-4 py-3">{t("columns.sku")}</TableHead>
                    <TableHead className="px-4 py-3 text-right">{t("columns.quantity")}</TableHead>
                    <TableHead className="px-4 py-3 text-right">{t("columns.price")}</TableHead>
                    <TableHead className="px-4 py-3 text-right lg:px-6">{t("columns.total")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sale.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="px-4 py-3 lg:px-6">
                        <div className="font-medium text-foreground">{line.product.name}</div>
                        {line.variant?.name ? (
                          <div className="text-xs text-muted-foreground">{line.variant.name}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-xs text-muted-foreground">
                        <div>{line.product.sku}</div>
                        {line.product.primaryBarcode ? <div>{line.product.primaryBarcode}</div> : null}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right">
                        {formatNumber(line.qty, locale)}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right">
                        {formatKgsMoney(line.unitPriceKgs, locale, currencySource)}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right font-semibold lg:px-6">
                        {formatKgsMoney(line.lineTotalKgs, locale, currencySource)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {completedReturns.length ? (
            <div className="border-t border-border p-4 lg:p-6">
              <h3 className="text-sm font-semibold text-foreground">{t("returnStatus")}</h3>
              <div className="mt-2 space-y-2">
                {completedReturns.map((saleReturn) => (
                  <div
                    key={saleReturn.id}
                    className="flex flex-col gap-1 rounded-md border border-border bg-muted/20 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium text-foreground">{saleReturn.number}</p>
                      <p className="text-xs text-muted-foreground">
                        {saleReturn.completedAt
                          ? formatDateTime(saleReturn.completedAt, locale)
                          : formatDateTime(saleReturn.createdAt, locale)}
                      </p>
                    </div>
                    <span className="font-semibold text-warning">
                      {formatKgsMoney(saleReturn.totalKgs, locale, currencySource)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <ModalFooter className="m-4 lg:m-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => void handlePdf("download")}
              disabled={Boolean(pdfAction)}
            >
              {pdfAction === "download" ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <DownloadIcon className="h-4 w-4" aria-hidden />
              )}
              {t("download")}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void handlePdf("print")}
              disabled={Boolean(pdfAction)}
            >
              {pdfAction === "print" ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <PrintIcon className="h-4 w-4" aria-hidden />
              )}
              {t("print")}
            </Button>
          </ModalFooter>
        </div>
      )}
    </Modal>
  );
};
