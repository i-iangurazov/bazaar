"use client";

import { useMemo, useState } from "react";
import { CustomerOrderStatus } from "@prisma/client";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { ResponsiveDataList } from "@/components/responsive-data-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DownloadIcon } from "@/components/icons";
import { downloadTableFile, type DownloadFormat } from "@/lib/fileExport";
import { formatCurrencyKGS, formatDateTime } from "@/lib/i18nFormat";
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

export const ReceiptRegistry = ({ title, subtitle, compact = false }: ReceiptRegistryProps) => {
  const t = useTranslations("pos.receipts");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const tPos = useTranslations("pos");
  const tExports = useTranslations("exports");
  const locale = useLocale();
  const { data: session } = useSession();
  const canView = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";

  const storesQuery = trpc.stores.list.useQuery(undefined, { enabled: canView });
  const now = useMemo(() => new Date(), []);
  const [storeId, setStoreId] = useState("");
  const [status, setStatus] = useState<"ALL" | CustomerOrderStatus>("ALL");
  const [fromDate, setFromDate] = useState(formatDateInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)));
  const [toDate, setToDate] = useState(formatDateInput(now));
  const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>("csv");

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

  const exportRows = (receiptsQuery.data?.items ?? []).map((receipt) => [
    receipt.number,
    receipt.createdAt ? new Date(receipt.createdAt).toISOString() : "",
    receipt.store.code,
    receipt.store.name,
    receipt.register?.code ?? "",
    receipt.cashier?.email ?? "",
    String(receipt.totalKgs),
    String(receipt.paymentBreakdown.CASH ?? 0),
    String(receipt.paymentBreakdown.CARD ?? 0),
    String(receipt.paymentBreakdown.TRANSFER ?? 0),
    String(receipt.paymentBreakdown.OTHER ?? 0),
    receipt.status,
    receipt.kkmStatus,
    receipt.fiscalReceipt?.id ?? "",
    receipt.fiscalReceipt?.fiscalNumber ?? "",
    receipt.fiscalReceipt?.lastError ?? "",
  ]);

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

  return (
    <div className="space-y-6">
      <div className={compact ? "" : "space-y-1"}>
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      {!canView ? (
        <p className="text-sm text-danger">{tErrors("forbidden")}</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("filtersTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-5">
              <Select value={storeId || "all"} onValueChange={(value) => setStoreId(value === "all" ? "" : value)}>
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

              <Select value={status} onValueChange={(value) => setStatus(value as "ALL" | CustomerOrderStatus)}>
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

              <div className="flex gap-2">
                <Select value={downloadFormat} onValueChange={(value) => setDownloadFormat(value as DownloadFormat)}>
                  <SelectTrigger aria-label={tExports("formatLabel")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">{tExports("formats.csv")}</SelectItem>
                    <SelectItem value="xlsx">{tExports("formats.xlsx")}</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="button" variant="secondary" onClick={handleExportCurrentView}>
                  <DownloadIcon className="h-4 w-4" aria-hidden />
                  {t("export")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("title")}</CardTitle>
            </CardHeader>
            <CardContent>
              {receiptsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="h-4 w-4" />
                  {tCommon("loading")}
                </div>
              ) : receiptsQuery.error ? (
                <div className="text-sm text-danger">{translateError(tErrors, receiptsQuery.error)}</div>
              ) : (receiptsQuery.data?.items ?? []).length ? (
                <ResponsiveDataList
                  items={receiptsQuery.data?.items ?? []}
                  getKey={(item) => item.id}
                  renderDesktop={(items) => (
                    <div className="overflow-x-auto">
                      <Table className="min-w-[1080px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("columns.number")}</TableHead>
                            <TableHead>{t("columns.date")}</TableHead>
                            <TableHead>{t("columns.store")}</TableHead>
                            <TableHead>{t("columns.cashier")}</TableHead>
                            <TableHead>{t("columns.total")}</TableHead>
                            <TableHead>{t("columns.payments")}</TableHead>
                            <TableHead>{t("columns.status")}</TableHead>
                            <TableHead>{t("columns.fiscal")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {items.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="font-medium">{item.number}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {formatDateTime(item.createdAt, locale)}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {item.store.name} ({item.store.code})
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {item.cashier?.name ?? item.cashier?.email ?? t("unknownCashier")}
                              </TableCell>
                              <TableCell>{formatCurrencyKGS(item.totalKgs, locale)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {paymentMethods
                                  .filter((method) => (item.paymentBreakdown[method] ?? 0) > 0)
                                  .map(
                                    (method) =>
                                      `${tPos(`payments.${method.toLowerCase()}`)}: ${formatCurrencyKGS(item.paymentBreakdown[method] ?? 0, locale)}`,
                                  )
                                  .join(" · ") || tCommon("notAvailable")}
                              </TableCell>
                              <TableCell>{statusLabel(item.status)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {kkmStatusLabel(item.kkmStatus)}
                                {item.fiscalReceipt?.lastError ? ` · ${item.fiscalReceipt.lastError}` : ""}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  renderMobile={(item) => (
                    <div className="rounded-md border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">{item.number}</p>
                        <span className="text-xs text-muted-foreground">{statusLabel(item.status)}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(item.createdAt, locale)}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.store.name} ({item.store.code})
                      </p>
                      <p className="mt-2 text-sm font-semibold text-foreground">
                        {formatCurrencyKGS(item.totalKgs, locale)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{kkmStatusLabel(item.kkmStatus)}</p>
                    </div>
                  )}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{t("empty")}</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};
