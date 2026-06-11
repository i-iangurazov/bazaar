"use client";

import { useMemo, useState } from "react";
import { CustomerOrderStatus } from "@prisma/client";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { ResponsiveDataList } from "@/components/responsive-data-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { DownloadIcon, PrintIcon, ShareIcon } from "@/components/icons";
import { downloadTableFile, type DownloadFormat } from "@/lib/fileExport";
import { currencySourceWithFallback, formatKgsMoney } from "@/lib/currencyDisplay";
import { formatDateTime } from "@/lib/i18nFormat";
import { downloadPdfBlob, fetchPdfBlob, printPdfBlob } from "@/lib/pdfClient";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

type ReceiptRegistryProps = {
  title: string;
  subtitle: string;
  compact?: boolean;
};

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);

const statusValues = [
  CustomerOrderStatus.COMPLETED,
  CustomerOrderStatus.CANCELED,
  CustomerOrderStatus.DRAFT,
  CustomerOrderStatus.CONFIRMED,
  CustomerOrderStatus.READY,
] as const;

const paymentMethods = ["CASH", "CARD", "TRANSFER", "OTHER"] as const;

type BadgeVariant = "default" | "success" | "warning" | "danger" | "muted";

export const ReceiptRegistry = ({ title, subtitle, compact = false }: ReceiptRegistryProps) => {
  const t = useTranslations("pos.receipts");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const tPos = useTranslations("pos");
  const tExports = useTranslations("exports");
  const locale = useLocale();
  const { data: session } = useSession();
  const { toast } = useToast();
  const canView = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";

  const storesQuery = trpc.stores.list.useQuery(undefined, { enabled: canView });
  const now = useMemo(() => new Date(), []);
  const [storeId, setStoreId] = useState("");
  const [status, setStatus] = useState<"ALL" | CustomerOrderStatus>("ALL");
  const [fromDate, setFromDate] = useState(
    formatDateInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)),
  );
  const [toDate, setToDate] = useState(formatDateInput(now));
  const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>("csv");
  const [receiptAction, setReceiptAction] = useState<{
    saleId: string;
    mode: "download" | "print" | "share";
  } | null>(null);

  const receiptsQuery = trpc.pos.receipts.useQuery(
    {
      storeId: storeId || undefined,
      statuses: status === "ALL" ? undefined : [status],
      dateFrom: fromDate ? new Date(`${fromDate}T00:00:00`) : undefined,
      dateTo: toDate ? new Date(`${toDate}T23:59:59`) : undefined,
      page: 1,
      pageSize: 100,
    },
    { enabled: canView, refetchOnWindowFocus: true },
  );
  const receipts = receiptsQuery.data?.items ?? [];

  const statusLabel = (value: CustomerOrderStatus) => {
    switch (value) {
      case CustomerOrderStatus.COMPLETED:
        return t("status.completed");
      case CustomerOrderStatus.CANCELED:
        return t("status.canceled");
      case CustomerOrderStatus.CONFIRMED:
        return t("status.confirmed");
      case CustomerOrderStatus.READY:
        return t("status.ready");
      default:
        return t("status.draft");
    }
  };

  const kkmStatusLabel = (value: "NOT_SENT" | "SENT" | "FAILED") => {
    if (value === "SENT") {
      return tPos("history.kkmStatusSent");
    }
    if (value === "FAILED") {
      return tPos("history.kkmStatusFailed");
    }
    return tPos("history.kkmStatusNotSent");
  };

  const statusBadgeVariant = (value: CustomerOrderStatus): BadgeVariant => {
    switch (value) {
      case CustomerOrderStatus.COMPLETED:
        return "success";
      case CustomerOrderStatus.CANCELED:
        return "danger";
      case CustomerOrderStatus.CONFIRMED:
      case CustomerOrderStatus.READY:
        return "warning";
      default:
        return "muted";
    }
  };

  const kkmBadgeVariant = (value: "NOT_SENT" | "SENT" | "FAILED"): BadgeVariant => {
    if (value === "SENT") {
      return "success";
    }
    if (value === "FAILED") {
      return "danger";
    }
    return "muted";
  };

  const exportRows = receipts.map((receipt) => {
    const currencySource = currencySourceWithFallback(receipt, receipt.store);
    return [
      receipt.number,
      receipt.createdAt ? new Date(receipt.createdAt).toISOString() : "",
      receipt.store.code,
      receipt.store.name,
      receipt.register?.code ?? "",
      receipt.cashier?.email ?? "",
      formatKgsMoney(receipt.totalKgs, locale, currencySource),
      formatKgsMoney(receipt.paymentBreakdown.CASH ?? 0, locale, currencySource),
      formatKgsMoney(receipt.paymentBreakdown.CARD ?? 0, locale, currencySource),
      formatKgsMoney(receipt.paymentBreakdown.TRANSFER ?? 0, locale, currencySource),
      formatKgsMoney(receipt.paymentBreakdown.OTHER ?? 0, locale, currencySource),
      receipt.status,
      receipt.kkmStatus,
      receipt.fiscalReceipt?.id ?? "",
      receipt.fiscalReceipt?.fiscalNumber ?? "",
      receipt.fiscalReceipt?.lastError ?? "",
    ];
  });

  const handleExportCurrentView = () => {
    downloadTableFile({
      format: downloadFormat,
      fileNameBase: `receipts-registry-${formatDateInput(new Date())}`,
      header: [
        "receiptNumber",
        "createdAtIso",
        "storeCode",
        "storeName",
        "registerCode",
        "cashierEmail",
        "totalKgs",
        "cashKgs",
        "cardKgs",
        "transferKgs",
        "otherKgs",
        "status",
        "kkmStatus",
        "fiscalReceiptId",
        "fiscalNumber",
        "fiscalError",
      ],
      rows: exportRows,
    });
  };

  const handleReceiptPdf = async (saleId: string, number: string, mode: "download" | "print") => {
    if (receiptAction) {
      return;
    }
    setReceiptAction({ saleId, mode });
    try {
      const blob = await fetchPdfBlob({
        url: `/api/pos/receipts/${saleId}/pdf?kind=precheck&action=${mode === "print" ? "reprint" : "download"}`,
      });
      if (mode === "print") {
        const result = await printPdfBlob(blob);
        if (!result.autoPrintAttempted) {
          toast({ variant: "info", description: tPos("sell.receiptPrintFallback") });
        }
      } else {
        downloadPdfBlob(blob, `pos-receipt-${number}-precheck.pdf`);
      }
    } catch {
      toast({ variant: "error", description: tPos("history.receiptPdfFailed") });
    } finally {
      setReceiptAction(null);
    }
  };

  const handleShareReceiptPdf = async (saleId: string, number: string) => {
    if (receiptAction) {
      return;
    }
    setReceiptAction({ saleId, mode: "share" });
    try {
      const blob = await fetchPdfBlob({
        url: `/api/pos/receipts/${saleId}/pdf?kind=precheck&action=download`,
      });
      const file = new File([blob], `pos-receipt-${number}-precheck.pdf`, {
        type: "application/pdf",
      });
      const shareNavigator = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      if (
        typeof shareNavigator.share === "function" &&
        (!shareNavigator.canShare || shareNavigator.canShare({ files: [file] }))
      ) {
        await shareNavigator.share({
          title: tPos("history.shareReceiptTitle", { number }),
          text: tPos("history.shareReceiptText", { number }),
          files: [file],
        });
      } else {
        downloadPdfBlob(blob, `pos-receipt-${number}-precheck.pdf`);
        toast({ variant: "info", description: tPos("history.shareUnavailable") });
      }
    } catch {
      toast({ variant: "error", description: tPos("history.receiptPdfFailed") });
    } finally {
      setReceiptAction(null);
    }
  };

  return (
    <div className="space-y-6">
      {compact ? (
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      ) : (
        <PageHeader title={title} subtitle={subtitle} />
      )}

      {!canView ? (
        <p className="text-sm text-danger">{tErrors("forbidden")}</p>
      ) : (
        <>
          <Card className="border-border/70 shadow-none">
            <CardHeader className="px-4 py-3 sm:px-5">
              <CardTitle className="text-base">{t("filtersTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-[minmax(180px,1.2fr)_minmax(150px,0.9fr)_140px_140px_minmax(230px,1fr)]">
              <Select
                value={storeId || "all"}
                onValueChange={(value) => setStoreId(value === "all" ? "" : value)}
              >
                <SelectTrigger aria-label={t("storeLabel")}>
                  <SelectValue placeholder={tCommon("selectStore")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allStores")}</SelectItem>
                  {(storesQuery.data ?? []).map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={status}
                onValueChange={(value) => setStatus(value as "ALL" | CustomerOrderStatus)}
              >
                <SelectTrigger aria-label={t("statusLabel")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t("status.all")}</SelectItem>
                  {statusValues.map((value) => (
                    <SelectItem key={value} value={value}>
                      {statusLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                aria-label={t("fromDate")}
              />

              <Input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                aria-label={t("toDate")}
              />

              <div className="flex min-w-0 gap-2">
                <Select
                  value={downloadFormat}
                  onValueChange={(value) => setDownloadFormat(value as DownloadFormat)}
                >
                  <SelectTrigger aria-label={tExports("formatLabel")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">{tExports("formats.csv")}</SelectItem>
                    <SelectItem value="xlsx">{tExports("formats.xlsx")}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={handleExportCurrentView}
                >
                  <DownloadIcon className="h-4 w-4" aria-hidden />
                  {t("export")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-border/70 shadow-none">
            <CardHeader className="flex flex-col gap-1 border-b border-border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <CardTitle className="text-base">{t("title")}</CardTitle>
              {!receiptsQuery.isLoading && !receiptsQuery.error ? (
                <p className="text-xs text-muted-foreground">
                  {t("receiptCount", { count: receipts.length })}
                </p>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              {receiptsQuery.isLoading ? (
                <div className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground sm:px-5">
                  <Spinner className="h-4 w-4" />
                  {tCommon("loading")}
                </div>
              ) : receiptsQuery.error ? (
                <div className="px-4 py-5 text-sm text-danger sm:px-5">
                  {translateError(tErrors, receiptsQuery.error)}
                </div>
              ) : receipts.length ? (
                <ResponsiveDataList
                  items={receipts}
                  getKey={(item) => item.id}
                  desktopClassName="border-0"
                  mobileClassName="p-3 sm:p-4"
                  renderDesktop={(items) => (
                    <div className="overflow-x-auto">
                      <Table className="min-w-[1120px]" sortable={false}>
                        <TableHeader className="bg-muted/40">
                          <TableRow>
                            <TableHead className="w-[140px] min-w-[140px] px-4 py-3">
                              {t("columns.number")}
                            </TableHead>
                            <TableHead className="w-[120px] min-w-[120px] px-4 py-3">
                              {t("columns.date")}
                            </TableHead>
                            <TableHead className="w-[130px] min-w-[130px] px-4 py-3">
                              {t("columns.store")}
                            </TableHead>
                            <TableHead className="w-[120px] min-w-[120px] px-4 py-3">
                              {t("columns.cashier")}
                            </TableHead>
                            <TableHead className="w-[130px] min-w-[130px] px-4 py-3 text-right">
                              {t("columns.total")}
                            </TableHead>
                            <TableHead className="w-[180px] min-w-[180px] px-4 py-3">
                              {t("columns.payments")}
                            </TableHead>
                            <TableHead className="w-[120px] min-w-[120px] px-4 py-3">
                              {t("columns.status")}
                            </TableHead>
                            <TableHead className="w-[160px] min-w-[160px] px-4 py-3">
                              {t("columns.fiscal")}
                            </TableHead>
                            <TableHead className="sticky right-0 z-10 w-[270px] min-w-[270px] bg-muted/40 px-4 py-3 text-right shadow-[-12px_0_16px_-16px_rgba(15,23,42,0.35)]">
                              {t("columns.actions")}
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {items.map((item) => {
                            const currencySource = currencySourceWithFallback(item, item.store);
                            const paymentEntries = paymentMethods
                              .map((method) => ({
                                method,
                                amount: item.paymentBreakdown[method] ?? 0,
                              }))
                              .filter((entry) => entry.amount > 0);
                            const isBusy = receiptAction?.saleId === item.id;
                            return (
                              <TableRow key={item.id} className="group hover:bg-muted/25">
                                <TableCell className="min-w-[140px] px-4 py-3 align-top">
                                  <div className="font-semibold text-foreground">{item.number}</div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {item.register?.code ?? tCommon("notAvailable")}
                                  </div>
                                </TableCell>
                                <TableCell className="px-4 py-3 align-top text-xs text-muted-foreground">
                                  {formatDateTime(item.createdAt, locale)}
                                </TableCell>
                                <TableCell className="px-4 py-3 align-top">
                                  <div className="text-sm text-foreground">{item.store.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {item.store.code}
                                  </div>
                                </TableCell>
                                <TableCell className="px-4 py-3 align-top text-xs text-muted-foreground">
                                  {item.cashier?.name ?? item.cashier?.email ?? t("unknownCashier")}
                                </TableCell>
                                <TableCell className="px-4 py-3 text-right align-top font-semibold text-foreground">
                                  {formatKgsMoney(item.totalKgs, locale, currencySource)}
                                </TableCell>
                                <TableCell className="px-4 py-3 align-top">
                                  {paymentEntries.length ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {paymentEntries.map((entry) => (
                                        <Badge
                                          key={entry.method}
                                          variant="default"
                                          className="bg-background text-muted-foreground"
                                        >
                                          {tPos(`payments.${entry.method.toLowerCase()}`)}
                                          <span className="font-semibold text-foreground">
                                            {formatKgsMoney(entry.amount, locale, currencySource)}
                                          </span>
                                        </Badge>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      {tCommon("notAvailable")}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="px-4 py-3 align-top">
                                  <Badge variant={statusBadgeVariant(item.status)}>
                                    {statusLabel(item.status)}
                                  </Badge>
                                </TableCell>
                                <TableCell className="px-4 py-3 align-top">
                                  <div className="flex max-w-[220px] flex-col gap-1">
                                    <Badge variant={kkmBadgeVariant(item.kkmStatus)}>
                                      {kkmStatusLabel(item.kkmStatus)}
                                    </Badge>
                                    {item.fiscalReceipt?.lastError ? (
                                      <span className="line-clamp-2 text-xs text-danger">
                                        {item.fiscalReceipt.lastError}
                                      </span>
                                    ) : null}
                                  </div>
                                </TableCell>
                                <TableCell className="sticky right-0 z-10 min-w-[270px] bg-card px-4 py-3 align-top shadow-[-12px_0_16px_-16px_rgba(15,23,42,0.35)] group-hover:bg-muted/25">
                                  <div className="flex justify-end">
                                    <div className="inline-flex overflow-hidden rounded-md border border-border bg-background shadow-sm">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        className="h-8 whitespace-nowrap rounded-none bg-transparent px-2.5 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
                                        aria-label={tPos("history.printPrecheck")}
                                        disabled={Boolean(receiptAction)}
                                        onClick={() =>
                                          void handleReceiptPdf(item.id, item.number, "print")
                                        }
                                      >
                                        {isBusy && receiptAction?.mode === "print" ? (
                                          <Spinner className="h-4 w-4" />
                                        ) : (
                                          <PrintIcon className="h-4 w-4" aria-hidden />
                                        )}
                                        <span>{t("printShort")}</span>
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        className="h-8 whitespace-nowrap rounded-none border-l border-border bg-transparent px-2.5 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
                                        aria-label={tPos("history.downloadPrecheck")}
                                        disabled={Boolean(receiptAction)}
                                        onClick={() =>
                                          void handleReceiptPdf(item.id, item.number, "download")
                                        }
                                      >
                                        {isBusy && receiptAction?.mode === "download" ? (
                                          <Spinner className="h-4 w-4" />
                                        ) : (
                                          <DownloadIcon className="h-4 w-4" aria-hidden />
                                        )}
                                        <span>{t("downloadShort")}</span>
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        className="h-8 whitespace-nowrap rounded-none border-l border-border bg-transparent px-2.5 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
                                        aria-label={tPos("history.shareReceipt")}
                                        disabled={Boolean(receiptAction)}
                                        onClick={() =>
                                          void handleShareReceiptPdf(item.id, item.number)
                                        }
                                      >
                                        {isBusy && receiptAction?.mode === "share" ? (
                                          <Spinner className="h-4 w-4" />
                                        ) : (
                                          <ShareIcon className="h-4 w-4" aria-hidden />
                                        )}
                                        <span>{t("shareShort")}</span>
                                      </Button>
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  renderMobile={(item) => (
                    <div className="rounded-md border border-border bg-card p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{item.number}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {item.register?.code ?? tCommon("notAvailable")}
                          </p>
                        </div>
                        <Badge variant={statusBadgeVariant(item.status)}>
                          {statusLabel(item.status)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDateTime(item.createdAt, locale)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.store.name} ({item.store.code})
                      </p>
                      <p className="mt-2 text-sm font-semibold text-foreground">
                        {formatKgsMoney(
                          item.totalKgs,
                          locale,
                          currencySourceWithFallback(item, item.store),
                        )}
                      </p>
                      <Badge className="mt-2" variant={kkmBadgeVariant(item.kkmStatus)}>
                        {kkmStatusLabel(item.kkmStatus)}
                      </Badge>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {paymentMethods
                          .map((method) => ({
                            method,
                            amount: item.paymentBreakdown[method] ?? 0,
                          }))
                          .filter((entry) => entry.amount > 0)
                          .map((entry) => (
                            <Badge
                              key={entry.method}
                              variant="default"
                              className="bg-background text-muted-foreground"
                            >
                              {tPos(`payments.${entry.method.toLowerCase()}`)}
                              <span className="font-semibold text-foreground">
                                {formatKgsMoney(
                                  entry.amount,
                                  locale,
                                  currencySourceWithFallback(item, item.store),
                                )}
                              </span>
                            </Badge>
                          ))}
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 px-2 text-xs"
                          onClick={() => void handleReceiptPdf(item.id, item.number, "print")}
                          disabled={Boolean(receiptAction)}
                        >
                          {receiptAction?.saleId === item.id && receiptAction.mode === "print" ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <PrintIcon className="h-4 w-4" aria-hidden />
                          )}
                          {t("printShort")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 px-2 text-xs"
                          onClick={() => void handleReceiptPdf(item.id, item.number, "download")}
                          disabled={Boolean(receiptAction)}
                        >
                          {receiptAction?.saleId === item.id &&
                          receiptAction.mode === "download" ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <DownloadIcon className="h-4 w-4" aria-hidden />
                          )}
                          {t("downloadShort")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 px-2 text-xs"
                          onClick={() => void handleShareReceiptPdf(item.id, item.number)}
                          disabled={Boolean(receiptAction)}
                        >
                          {receiptAction?.saleId === item.id && receiptAction.mode === "share" ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <ShareIcon className="h-4 w-4" aria-hidden />
                          )}
                          {t("shareShort")}
                        </Button>
                      </div>
                    </div>
                  )}
                />
              ) : (
                <p className="px-4 py-5 text-sm text-muted-foreground sm:px-5">{t("empty")}</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};
