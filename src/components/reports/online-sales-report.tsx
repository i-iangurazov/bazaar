"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { QueryErrorState } from "@/components/query-error-state";
import { ReportMetric } from "@/components/reports/report-metric";
import {
  ReportPagination,
  ReportPeriodControls,
  ReportSelect,
  ReportTable,
  type ReportScope,
} from "@/components/reports/report-controls";
import { Button } from "@/components/ui/button";
import { SelectItem } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { baseAccountingCurrency, formatKgsMoney } from "@/lib/currencyDisplay";
import { downloadTableFile, type DownloadFormat } from "@/lib/fileExport";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { reportError } from "@/lib/reporting";
import { trpc } from "@/lib/trpc";

const OnlineSalesChart = dynamic(
  () =>
    import("@/components/reports/sales-overview-chart").then((module) => module.SalesOverviewChart),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

const onlineSorts = ["date", "amount", "number"] as const;
type OnlineSort = (typeof onlineSorts)[number];
const isOnlineSort = (value: string): value is OnlineSort =>
  (onlineSorts as readonly string[]).includes(value);

export function OnlineSalesReport({ scope }: { scope: ReportScope }) {
  const { state, update, enabled } = scope;
  const t = useTranslations("onlineSales");
  const r = useTranslations("reporting");
  const errors = useTranslations("errors");
  const locale = useLocale();
  const utils = trpc.useUtils();
  const [format, setFormat] = useState<DownloadFormat>("csv");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<{ fingerprint: string; text: string } | null>(null);

  const sort: OnlineSort = isOnlineSort(state.sort) ? state.sort : "date";
  const input = {
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    storeId: state.storeId,
    channel: state.onlineChannel,
    source: state.source,
    sort,
    direction: state.direction,
    page: state.page,
    pageSize: 25,
  };
  const query = trpc.reports.onlineSales.useQuery(input, {
    enabled,
    staleTime: 0,
    cacheTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const data = query.data;
  const loyalty = trpc.reports.loyaltyActivity.useQuery(
    { dateFrom: state.dateFrom, dateTo: state.dateTo, storeId: state.storeId },
    { enabled, retry: false, staleTime: 30_000 },
  );

  const money = (value: number | null | undefined) =>
    value === null || value === undefined
      ? "—"
      : formatKgsMoney(value, locale, baseAccountingCurrency);
  const number = (value: number | null | undefined) =>
    value === null || value === undefined
      ? "—"
      : formatNumber(value, locale, { maximumFractionDigits: 2 });
  const delta = (current: number, previous: number) =>
    previous === 0 ? undefined : money(current - previous);

  const exportTable = async () => {
    if (!enabled || exporting) return;
    const guard = scope.exportGuard();
    setExporting(true);
    setExportError(null);
    try {
      const result = await utils.client.reports.onlineSalesExport.query({
        ...input,
        page: undefined,
        pageSize: undefined,
      });
      if (!guard()) return;
      await downloadTableFile({
        format,
        fileNameBase: `online-sales-${state.dateFrom}-${state.dateTo}`,
        header: [
          t("table.order"),
          t("table.createdAt"),
          t("table.customer"),
          t("table.store"),
          t("table.source"),
          t("table.status"),
          t("table.paymentStatus"),
          `${t("table.total")} KGS`,
          `${t("table.discount")} KGS`,
          `${t("table.returned")} KGS`,
        ],
        rows: [
          ...result.items.map((row) => [
            row.number,
            row.createdAt,
            row.customerName ?? row.customerEmail ?? row.customerPhone ?? "",
            row.storeName,
            t(`source.${row.source}` as never),
            t(`status.${row.status}` as never),
            t(`payment.${row.paymentStatus}` as never),
            String(row.totalKgs),
            String(row.discountKgs),
            String(row.returnsKgs),
          ]),
          [
            r("total"),
            "",
            "",
            "",
            "",
            "",
            "",
            String(result.sales.grossKgs),
            String(result.sales.discountKgs),
            String(result.sales.returnsKgs),
          ],
          [
            r("context"),
            JSON.stringify({
              dateFrom: state.dateFrom,
              dateTo: state.dateTo,
              store: state.storeId ?? "all",
              channel: state.onlineChannel,
              source: state.source,
              generatedAt: result.meta.generatedAt,
              timeZone: result.period.timeZone,
            }),
          ],
        ],
        shouldDownload: guard,
      });
    } catch (error) {
      if (guard())
        setExportError({ fingerprint: scope.fingerprint, text: reportError(errors, error) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-w-0 space-y-5">
      <ReportPeriodControls scope={scope}>
        <ReportSelect
          label={t("channelLabel")}
          value={state.onlineChannel}
          onChange={(value) => update({ onlineChannel: value, page: undefined })}
        >
          <SelectItem value="ONLINE">{t("channel.ONLINE")}</SelectItem>
          <SelectItem value="UNKNOWN">{t("channel.UNKNOWN")}</SelectItem>
        </ReportSelect>
        <ReportSelect
          label={t("sourceLabel")}
          value={state.source}
          onChange={(value) => update({ source: value, page: undefined })}
        >
          <SelectItem value="all">{t("source.all")}</SelectItem>
          {(["CATALOG", "API", "MANUAL"] as const).map((value) => (
            <SelectItem key={value} value={value}>
              {t(`source.${value}` as never)}
            </SelectItem>
          ))}
        </ReportSelect>
      </ReportPeriodControls>

      {scope.error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {scope.error}
        </p>
      )}
      {enabled && query.error && <QueryErrorState onRetry={() => void query.refetch()} />}
      {scope.allowed && !scope.error && !data && !query.error && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-busy="true">
          {[1, 2, 3, 4].map((key) => (
            <Skeleton key={key} className="h-36" />
          ))}
        </div>
      )}

      {data && (
        <>
          <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
            <div>
              <h2 className="font-semibold">{t("created.title")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("created.note")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <ReportMetric
                title={t("created.count")}
                value={number(data.created.count)}
                note={t("created.countNote")}
                previous={
                  data.period.comparisonAvailable === false
                    ? undefined
                    : number(data.created.previous.count)
                }
                accent
              />
              <ReportMetric
                title={t("created.amount")}
                value={money(data.created.totalKgs)}
                note={t("created.amountNote")}
                previous={
                  data.period.comparisonAvailable === false
                    ? undefined
                    : money(data.created.previous.totalKgs)
                }
              />
              <ReportMetric
                title={t("created.inProgress")}
                value={number(data.created.inProgress)}
                note={t("created.inProgressNote", {
                  draft: data.created.draft,
                  confirmed: data.created.confirmed,
                  ready: data.created.ready,
                })}
                onClick={() => update({ report: "online" })}
              />
              <ReportMetric
                title={t("created.completedCanceled")}
                value={number(data.created.completed)}
                note={t("created.completedCanceledNote", { canceled: data.created.canceled })}
              />
            </div>
            {data.created.bySource.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {data.created.bySource.map((row) => (
                  <span key={row.source}>
                    {t(`source.${row.source}` as never)}: {number(row.count)} · {money(row.totalKgs)}
                  </span>
                ))}
              </div>
            )}
            {data.unknownCreatedCount > 0 && state.onlineChannel === "ONLINE" && (
              <p className="text-xs text-muted-foreground">
                {t("created.unknownNote", { count: data.unknownCreatedCount })}
              </p>
            )}
          </section>

          <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
            <div>
              <h2 className="font-semibold">{t("sales.title")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("sales.note")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <ReportMetric
                title={t("sales.gross")}
                value={money(data.sales.grossKgs)}
                note={t("sales.grossNote", { count: data.sales.count })}
                previous={
                  data.period.comparisonAvailable === false
                    ? undefined
                    : money(data.sales.previous.grossKgs)
                }
                accent
              />
              <ReportMetric
                title={t("sales.returns")}
                value={money(data.sales.returnsKgs)}
                note={t("sales.returnsNote")}
                previous={
                  data.period.comparisonAvailable === false
                    ? undefined
                    : money(data.sales.previous.returnsKgs)
                }
              />
              <ReportMetric
                title={t("sales.net")}
                value={money(data.sales.netKgs)}
                note={t("sales.netNote")}
              />
              <ReportMetric
                title={t("sales.average")}
                value={money(data.sales.averageKgs)}
                note={t("sales.discountNote", { amount: money(data.sales.discountKgs) })}
              />
            </div>
            <dl className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border p-3">
                <dt className="text-xs text-muted-foreground">{t("sales.paid")}</dt>
                <dd className="mt-1 font-semibold tabular-nums">
                  {data.sales.paymentsKnown ? money(data.sales.paidKgs) : t("sales.noPaymentData")}
                </dd>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.sales.paymentsKnown ? t("sales.paidNote") : t("sales.noPaymentDataNote")}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <dt className="text-xs text-muted-foreground">{t("sales.debt")}</dt>
                <dd className="mt-1 font-semibold tabular-nums">{money(data.sales.debtKgs)}</dd>
                <p className="mt-1 text-xs text-muted-foreground">{t("sales.debtNote")}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <dt className="text-xs text-muted-foreground">{t("sales.returnCount")}</dt>
                <dd className="mt-1 font-semibold tabular-nums">{number(data.sales.returnCount)}</dd>
                <p className="mt-1 text-xs text-muted-foreground">{t("sales.returnCountNote")}</p>
              </div>
            </dl>
          </section>

          <section className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{t("chart.title")}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{t("chart.note")}</p>
              </div>
            </div>
            {data.sales.count || data.created.count ? (
              <div className="mt-5 h-64 sm:h-72">
                <OnlineSalesChart
                  data={data.series.map((point) => ({
                    date: point.date,
                    grossSalesKgs: point.completedKgs,
                    returnsKgs: point.returnsKgs,
                    netSalesKgs: Math.round((point.completedKgs - point.returnsKgs) * 100) / 100,
                    receiptCount: point.completedCount,
                    averageReceiptKgs: point.completedCount
                      ? Math.round((point.completedKgs / point.completedCount) * 100) / 100
                      : null,
                  }))}
                  locale={locale}
                  currencySource={baseAccountingCurrency}
                  labels={{
                    netSales: r("netSales"),
                    grossSales: r("grossSales"),
                    returns: r("returns"),
                    receipts: r("salesCount"),
                    averageReceipt: r("averageReceipt"),
                  }}
                  onSelectDate={(date) => update({ dateFrom: date, dateTo: date, page: undefined })}
                  hideCostProfit
                />
              </div>
            ) : (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                {r("emptyPeriod")}
              </div>
            )}
          </section>

          {loyalty.data ? (
            <section className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
              <div>
                <h2 className="font-semibold">{t("loyaltyTitle")}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{t("loyaltyNote")}</p>
              </div>
              <dl className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
                {(
                  [
                    [t("loyaltyMemberDiscount"), money(loyalty.data.memberDiscountKgs)],
                    [t("loyaltySpent"), number(loyalty.data.pointsSpent)],
                    [t("loyaltyEarned"), number(loyalty.data.pointsEarned)],
                    [t("loyaltyRestored"), number(loyalty.data.pointsRestored)],
                    [t("loyaltyCancelled"), number(loyalty.data.pointsCancelled)],
                  ] as const
                ).map(([name, value]) => (
                  <div key={name} className="rounded-lg border border-border p-3">
                    <dt className="text-xs text-muted-foreground">{name}</dt>
                    <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
            <div className="space-y-4 border-b border-border p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{t("table.title")}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{t("table.note")}</p>
                </div>
                <div className="flex items-end gap-2">
                  <ReportSelect label={r("format")} value={format} onChange={(value) => setFormat(value as DownloadFormat)}>
                    <SelectItem value="csv">{"CSV"}</SelectItem>
                    <SelectItem value="xlsx">{"XLSX"}</SelectItem>
                  </ReportSelect>
                  <Button variant="secondary" disabled={exporting || !enabled} onClick={() => void exportTable()}>
                    {exporting ? t("table.exporting") : t("table.export")}
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
                <ReportSelect
                  label={r("sort")}
                  value={sort}
                  onChange={(value) => update({ sort: value, page: undefined })}
                >
                  {onlineSorts.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`sort.${value}` as never)}
                    </SelectItem>
                  ))}
                </ReportSelect>
                <ReportSelect
                  label={r("direction")}
                  value={state.direction}
                  onChange={(direction) => update({ direction, page: undefined })}
                >
                  <SelectItem value="desc">{r("descending")}</SelectItem>
                  <SelectItem value="asc">{r("ascending")}</SelectItem>
                </ReportSelect>
              </div>
              {exportError?.fingerprint === scope.fingerprint && (
                <p role="alert" className="text-sm text-danger">
                  {exportError.text}
                </p>
              )}
            </div>
            {data.items.length ? (
              <ReportTable className="min-w-[1100px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("table.order")}</TableHead>
                    <TableHead>{t("table.createdAt")}</TableHead>
                    <TableHead>{t("table.customer")}</TableHead>
                    <TableHead>{t("table.store")}</TableHead>
                    <TableHead>{t("table.source")}</TableHead>
                    <TableHead>{t("table.status")}</TableHead>
                    <TableHead>{t("table.paymentStatus")}</TableHead>
                    <TableHead className="text-right">{t("table.total")}</TableHead>
                    <TableHead className="text-right">{t("table.discount")}</TableHead>
                    <TableHead className="text-right">{t("table.returned")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link
                          className="font-medium text-primary hover:underline"
                          href={`/sales/orders/${row.id}`}
                        >
                          {row.number}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(new Date(row.createdAt), locale)}
                      </TableCell>
                      <TableCell className="max-w-[16rem] truncate">
                        {row.customerName ?? row.customerEmail ?? row.customerPhone ?? "—"}
                      </TableCell>
                      <TableCell>{row.storeName}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {t(`source.${row.source}` as never)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {t(`status.${row.status}` as never)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {t(`payment.${row.paymentStatus}` as never)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.totalKgs)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.discountKgs)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.returnsKgs)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ReportTable>
            ) : (
              <div className="space-y-3 p-10 text-center">
                <h3 className="font-medium">{r("emptyPeriod")}</h3>
                <p className="text-sm text-muted-foreground">{r("emptyHelp")}</p>
              </div>
            )}
            <ReportPagination
              page={data.page}
              total={data.total}
              pageSize={data.pageSize}
              onPage={(page) => update({ page })}
            />
          </section>

          <details className="rounded-xl border border-border bg-card p-4 text-sm">
            <summary className="cursor-pointer font-medium">{r("methodology")}</summary>
            <div className="mt-3 max-w-4xl space-y-2 leading-6 text-muted-foreground">
              <p>{t("method")}</p>
            </div>
          </details>

          {delta(data.sales.netKgs, data.sales.previous.grossKgs - data.sales.previous.returnsKgs) ===
            undefined &&
            data.period.comparisonAvailable !== false && (
              <p className="text-xs text-muted-foreground">
                {r("comparison", {
                  from: data.period.previousDateFrom,
                  to: data.period.previousDateTo,
                })}
              </p>
            )}
        </>
      )}
    </div>
  );
}
