"use client";

import { Suspense, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { PageHeader } from "@/components/page-header";
import { ReceiptPreviewModal } from "@/components/pos/receipt-preview-modal";
import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import { SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ReportTable as Table,
  ReportPagination,
  ReportPeriodControls,
  ReportSelect,
  ReportField,
  useReportScope,
} from "@/components/reports/report-controls";
import { ReportMetric } from "@/components/reports/report-metric";
import { baseAccountingCurrency, formatKgsMoney } from "@/lib/currencyDisplay";
import { downloadTableFile, type DownloadFormat } from "@/lib/fileExport";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { reportHref, salesViews, type SalesView } from "@/lib/reporting";
import { trpc } from "@/lib/trpc";
import { reportError } from "@/lib/reporting";
import type { SalesReportInput, SalesReportRow } from "@/server/services/reporting/sales";

const SalesOverviewChart = dynamic(
  () =>
    import("@/components/reports/sales-overview-chart").then((module) => module.SalesOverviewChart),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

function AnalyticsReportContent() {
  const scope = useReportScope("sales");
  const { state, update, enabled } = scope;
  const t = useTranslations("reporting"),
    a = useTranslations("analytics"),
    errors = useTranslations("errors");
  const locale = useLocale();
  const utils = trpc.useUtils();
  const [format, setFormat] = useState<DownloadFormat>("csv");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<{ fingerprint: string; text: string } | null>(
    null,
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [showExtraFilters, setShowExtraFilters] = useState(false);
  const input = {
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    storeId: state.storeId,
    channel: state.channel,
    registerId: state.registerId,
    cashierId: state.cashierId,
    category: state.category,
    search: scope.search.trim() || undefined,
    productId: state.productId,
    variantKey: state.variantKey,
    customerKey: state.customerKey,
    documentId: state.documentId,
    kind: state.kind,
    view: state.view as SalesView,
    sort: state.sort as SalesReportInput["sort"],
    direction: state.direction,
    page: state.page,
    pageSize: 25,
  };
  const query = trpc.reports.sales.useQuery(input, {
    enabled,
    keepPreviousData: false,
    staleTime: 0,
    cacheTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const options = trpc.reports.filterOptions.useQuery(
    { storeId: state.storeId },
    { enabled, staleTime: 0, cacheTime: 0, retry: false },
  );
  const data = enabled && !query.error ? query.data : undefined;
  const money = (value: number | null | undefined) =>
    value === null || value === undefined
      ? "—"
      : formatKgsMoney(value, locale, baseAccountingCurrency);
  const number = (value: number | null | undefined) =>
    value === null || value === undefined
      ? "—"
      : formatNumber(value, locale, { maximumFractionDigits: 2 });
  const percent = (value: number | null | undefined) =>
    value === null || value === undefined ? "—" : `${number(value)}%`;
  const label = (name: string | null) =>
    name?.startsWith("__") ? t(`special.${name}`) : (name ?? "—");
  const totals = data?.totals;
  const detail = (patch: Record<string, string | number | undefined | null>) =>
    update({ view: "documents", ...patch });
  const setSelectedDay = (date: string) => detail({ dateFrom: date, dateTo: date });
  const openRow = (row: SalesReportRow) => {
    switch (input.view) {
      case "products":
        detail({ productId: row.productId ?? "__unallocated__", variantKey: row.variantKey });
        break;
      case "categories":
        detail({ category: row.name });
        break;
      case "stores":
        detail({ storeId: row.storeId });
        break;
      case "staff":
        detail({ cashierId: row.employeeId ?? "__unknown__" });
        break;
      case "customers":
        detail({ customerKey: row.customerKey });
        break;
      case "days":
        if (row.date) setSelectedDay(row.date);
        break;
      case "documents":
      case "costGaps":
        if (row.kind === "return") setPreview(row.originalSaleId);
        else if (row.channel === "pos") setPreview(row.documentId);
        break;
    }
  };
  const exportTable = async () => {
    if (!enabled || exporting) return;
    const guard = scope.exportGuard();
    setExporting(true);
    setExportError(null);
    try {
      const result = await utils.client.reports.salesExport.query({
        ...input,
        page: undefined,
        pageSize: undefined,
      });
      if (!guard()) return;
      const serialize = (row: typeof result.totals) =>
        [
          row.grossSalesKgs,
          row.returnsKgs,
          row.netSalesKgs,
          row.costKgs,
          row.grossProfitKgs,
          row.marginPercent,
          row.markupPercent,
          row.discountKgs,
          row.receiptCount,
          row.returnCount,
          row.unknownCostLines,
          row.knownCostKgs,
          row.knownProfitKgs,
        ].map((value) => (value === null ? t("unknown") : String(value)));
      await downloadTableFile({
        format,
        fileNameBase: `sales-${input.view}-all-filtered-${state.dateFrom}-${state.dateTo}`,
        header: [
          t(`views.${input.view}`),
          t("unit"),
          t("quantitySold"),
          t("quantityReturned"),
          t("quantity"),
          `${t("grossSales")} KGS`,
          `${t("returns")} KGS`,
          `${t("netSales")} KGS`,
          `${t("cost")} KGS`,
          `${t("profit")} KGS`,
          `${t("margin")} %`,
          `${t("markup")} %`,
          `${t("discount")} KGS`,
          t("salesCount"),
          t("returnCount"),
          t("unknownLines"),
          `${t("knownCost")} KGS`,
          `${t("knownProfit")} KGS`,
        ],
        rows: [
          ...result.items.map((row) => [
            label(row.name),
            input.view === "products" ? (row.unit ?? "") : "",
            ...[row.quantitySold, row.quantityReturned, row.netQuantity].map((value) =>
              input.view === "products" ? String(value) : "",
            ),
            ...serialize(row),
          ]),
          [
            t(input.view === "costGaps" ? "filteredTotals" : "total"),
            "",
            "",
            "",
            "",
            ...serialize(result.totals),
          ],
          [
            t("context"),
            JSON.stringify({
              dateFrom: state.dateFrom,
              dateTo: state.dateTo,
              store: state.storeId ?? "all",
              channel: state.channel,
              category: state.category,
              search: input.search,
              product: state.productId,
              customer: state.customerKey,
              cashier: state.cashierId,
              register: state.registerId,
              kind: state.kind,
              document: state.documentId,
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
  const filters = [
    "category",
    "registerId",
    "cashierId",
    "productId",
    "customerKey",
    "documentId",
    "kind",
  ] as const;
  const activeFilters = filters.filter((key) => state[key]);
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title={t("analyticsTitle")}
        subtitle={[data?.meta.organizationName, t("analyticsSubtitle")].filter(Boolean).join(" · ")}
        action={
          <>
            <Button asChild variant="secondary">
              <Link
                href={reportHref("/reports", {
                  dateFrom: state.dateFrom,
                  dateTo: state.dateTo,
                  storeId: state.storeId,
                  channel: "all",
                })}
              >
                {t("reportCenter")}
              </Link>
            </Button>
            <Button
              variant="secondary"
              disabled={!enabled || query.isFetching}
              onClick={() => void query.refetch()}
            >
              {t("refresh")}
            </Button>
          </>
        }
      />
      <ReportPeriodControls scope={scope}>
        <ReportSelect
          label={t("channel")}
          value={state.channel}
          onChange={(channel) => update({ channel, registerId: undefined })}
        >
          {["all", "pos", "orders"].map((value) => (
            <SelectItem key={value} value={value}>
              {t(`channels.${value}`)}
            </SelectItem>
          ))}
        </ReportSelect>
      </ReportPeriodControls>
      <section
        className="space-y-3 rounded-xl border border-border bg-card p-4"
        aria-label={t("refine")}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ReportField label={a("filters.productSearch")}>
            <Input
              aria-label={a("filters.productSearch")}
              placeholder={t("searchPlaceholder")}
              value={scope.search}
              onChange={(event) => scope.setSearch(event.target.value)}
              onBlur={() => {
                if ((state.search ?? "") !== scope.search)
                  update({ search: scope.search || undefined });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") update({ search: scope.search || undefined });
              }}
            />
          </ReportField>
          <Button
            className="sm:hidden"
            variant="secondary"
            aria-expanded={showExtraFilters}
            aria-controls="report-extra-filters"
            onClick={() => setShowExtraFilters((value) => !value)}
          >
            {t("refine")}
          </Button>
          <div
            id="report-extra-filters"
            className={showExtraFilters ? "contents" : "hidden sm:contents"}
          >
            <ReportSelect
              label={t("category")}
              value={state.category ?? "all"}
              onChange={(value) => update({ category: value === "all" ? undefined : value })}
            >
              <SelectItem value="all">{t("allCategories")}</SelectItem>
              <SelectItem value="__uncategorized__">{t("special.__uncategorized__")}</SelectItem>
              {options.data?.categories.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </ReportSelect>
            <ReportSelect
              label={t("register")}
              value={state.registerId ?? "all"}
              onChange={(value) => update({ registerId: value === "all" ? undefined : value })}
            >
              <SelectItem value="all">{t("allRegisters")}</SelectItem>
              {options.data?.registers.map((value) => (
                <SelectItem key={value.id} value={value.id}>
                  {value.name}
                </SelectItem>
              ))}
            </ReportSelect>
            <ReportSelect
              label={t("employee")}
              value={state.cashierId ?? "all"}
              onChange={(value) => update({ cashierId: value === "all" ? undefined : value })}
            >
              <SelectItem value="all">{t("allEmployees")}</SelectItem>
              {options.data?.employees.map((value) => (
                <SelectItem key={value.id} value={value.id}>
                  {value.name}
                </SelectItem>
              ))}
            </ReportSelect>
          </div>
        </div>
        {activeFilters.length > 0 || scope.search ? (
          <div className="flex flex-wrap items-center gap-2">
            {activeFilters.map((key) => (
              <Button
                key={key}
                size="sm"
                variant="outline"
                onClick={() =>
                  update({
                    [key]: undefined,
                    ...(key === "productId" ? { variantKey: undefined } : {}),
                  })
                }
              >
                {t(`filterNames.${key}`)}: {key === "category" ? label(state[key]!) : t("selected")}{" "}
                ×
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                scope.setSearch("");
                update({
                  category: undefined,
                  registerId: undefined,
                  cashierId: undefined,
                  productId: undefined,
                  variantKey: undefined,
                  customerKey: undefined,
                  documentId: undefined,
                  kind: undefined,
                  search: undefined,
                });
              }}
            >
              {t("reset")}
            </Button>
          </div>
        ) : null}
      </section>
      {scope.error && (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger"
        >
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
      {data && totals && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <ReportMetric
              title={t("netSales")}
              value={money(totals.netSalesKgs)}
              note={t("netSalesNote")}
              previous={
                data.period.comparisonAvailable === false
                  ? undefined
                  : money(data.previous.netSalesKgs)
              }
              onClick={() => detail({})}
              accent
            />
            <ReportMetric
              title={t("cost")}
              value={money(totals.costKgs)}
              note={
                totals.unknownCostLines
                  ? t("partialCost", {
                      count: totals.unknownCostLines,
                      amount: money(totals.knownCostKgs),
                    })
                  : t("costNote")
              }
              previous={
                data.period.comparisonAvailable === false ? undefined : money(data.previous.costKgs)
              }
              onClick={() =>
                update({ view: totals.unknownCostLines ? "costGaps" : "products", sort: "cost" })
              }
            />
            <ReportMetric
              title={t("profit")}
              value={money(totals.grossProfitKgs)}
              note={
                totals.unknownCostLines
                  ? t("partialProfit", { amount: money(totals.knownProfitKgs) })
                  : t("profitNote")
              }
              previous={
                data.period.comparisonAvailable === false
                  ? undefined
                  : money(data.previous.grossProfitKgs)
              }
              onClick={() => update({ view: "products", sort: "profit" })}
            />
            <ReportMetric
              title={t("margin")}
              value={percent(totals.marginPercent)}
              note={t("marginNote", { markup: percent(totals.markupPercent) })}
              previous={
                data.period.comparisonAvailable === false
                  ? undefined
                  : percent(data.previous.marginPercent)
              }
              onClick={() => update({ view: "categories", sort: "profit" })}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <p>
              {data.period.comparisonAvailable === false
                ? t("futurePeriod")
                : t("comparison", {
                    from: data.period.previousDateFrom,
                    to: data.period.previousDateTo,
                  })}
              {data.period.partial ? ` · ${t("partialPeriod")}` : ""}
            </p>
            <p>{t("updated", { date: formatDateTime(data.meta.generatedAt, locale) })}</p>
          </div>
          {(totals.unknownCostLines > 0 || totals.amountConflictDocuments > 0) && (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4"
              role="status"
            >
              <div className="max-w-3xl">
                <h2 className="text-sm font-semibold">{t("qualityTitle")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("qualityNote", {
                    percent: percent(totals.coveragePercent),
                    unknown: totals.unknownCostLines,
                    zero: totals.zeroCostLines,
                    conflicts: totals.amountConflictDocuments,
                  })}
                </p>
              </div>
              <Button variant="outline" onClick={() => update({ view: "costGaps" })}>
                {t("reviewCost")}
              </Button>
            </div>
          )}
          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
            <section className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{t("trend")}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{t("trendNote")}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => update({ view: "days", sort: "date" })}
                >
                  {t("table")}
                </Button>
              </div>
              {totals.lineCount ? (
                <div className="mt-5 h-64 sm:h-72">
                  <SalesOverviewChart
                    data={data.series}
                    locale={locale}
                    currencySource={baseAccountingCurrency}
                    labels={{
                      netSales: t("netSales"),
                      grossSales: t("grossSales"),
                      returns: t("returns"),
                      receipts: t("salesCount"),
                      averageReceipt: t("averageReceipt"),
                      cost: t("cost"),
                      profit: t("profit"),
                    }}
                    onSelectDate={setSelectedDay}
                  />
                </div>
              ) : (
                <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                  {t("emptyPeriod")}
                </div>
              )}
            </section>
            <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <h2 className="font-semibold">{t("resultDrivers")}</h2>
              <dl className="mt-3 divide-y divide-border">
                {[
                  [t("grossSales"), money(totals.grossSalesKgs)],
                  [t("returns"), money(totals.returnsKgs)],
                  [t("discount"), money(totals.discountKgs)],
                  [t("salesCount"), number(totals.receiptCount)],
                  [t("averageReceipt"), money(totals.averageReceiptKgs)],
                  [t("returnRate"), percent(totals.returnRatePercent)],
                ].map(([name, value]) => (
                  <div key={name} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <dt className="text-muted-foreground">{name}</dt>
                    <dd className="whitespace-nowrap font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 w-full"
                onClick={() => detail({ kind: "return" })}
              >
                {t("inspectReturns", { count: totals.returnCount })}
              </Button>
            </section>
          </div>
          <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
            <div className="space-y-4 border-b border-border p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{t("detail")}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{t("detailNote")}</p>
                </div>
                <div className="flex items-end gap-2">
                  <ReportSelect
                    label={t("format")}
                    value={format}
                    onChange={(value) => setFormat(value as DownloadFormat)}
                  >
                    <SelectItem value="csv">{"CSV"}</SelectItem>
                    <SelectItem value="xlsx">{"XLSX"}</SelectItem>
                  </ReportSelect>
                  <Button
                    variant="secondary"
                    disabled={exporting || !enabled}
                    onClick={() => void exportTable()}
                  >
                    {exporting ? a("actions.exportingProducts") : a("actions.exportAllProducts")}
                  </Button>
                </div>
              </div>
              <nav aria-label={t("dimensions")} className="flex flex-wrap gap-1.5">
                {salesViews.map((view) => (
                  <Button
                    key={view}
                    size="sm"
                    variant={input.view === view ? "primary" : "ghost"}
                    aria-current={input.view === view ? "page" : undefined}
                    onClick={() =>
                      update({
                        view,
                        sort: view === "days" || view === "documents" ? "date" : "revenue",
                      })
                    }
                  >
                    {t(`views.${view}`)}
                  </Button>
                ))}
              </nav>
              <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
                <ReportSelect
                  label={t("sort")}
                  value={state.sort}
                  onChange={(sort) => update({ sort })}
                >
                  {["revenue", "profit", "cost", "returns", "name", "date"].map((sort) => (
                    <SelectItem key={sort} value={sort}>
                      {t(`sorts.${sort}`)}
                    </SelectItem>
                  ))}
                </ReportSelect>
                <ReportSelect
                  label={t("direction")}
                  value={state.direction}
                  onChange={(direction) => update({ direction })}
                >
                  <SelectItem value="desc">{t("descending")}</SelectItem>
                  <SelectItem value="asc">{t("ascending")}</SelectItem>
                </ReportSelect>
              </div>
              {input.view === "customers" && (
                <p className="text-xs text-muted-foreground">
                  {t("customerMethod", {
                    count: totals.identifiedCustomers,
                    anonymous: totals.anonymousSales,
                  })}
                </p>
              )}
              {input.view === "costGaps" && (
                <p className="text-xs text-muted-foreground">{t("costGapMethod")}</p>
              )}
              {exportError?.fingerprint === scope.fingerprint && (
                <p role="alert" className="text-sm text-danger">
                  {exportError.text}
                </p>
              )}
            </div>
            {data.items.length ? (
              <Table sortable={false} className="min-w-[1200px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-72 min-w-[14rem] sm:min-w-[18rem]">
                      {t(`views.${input.view}`)}
                    </TableHead>
                    <TableHead className="text-right">{t("netSales")}</TableHead>
                    <TableHead className="text-right">{t("cost")}</TableHead>
                    <TableHead className="text-right">{t("profit")}</TableHead>
                    <TableHead className="text-right">{t("margin")}</TableHead>
                    <TableHead className="text-right">{t("returns")}</TableHead>
                    <TableHead className="text-right">
                      {input.view === "products" ? t("quantity") : t("salesCount")}
                    </TableHead>
                    <TableHead>{t("quality")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="w-72 min-w-[14rem] max-w-80 sm:min-w-[18rem]">
                        <div className="flex flex-col gap-1">
                          {row.channel === "orders" &&
                          ["documents", "costGaps"].includes(input.view) ? (
                            <Link
                              className="font-medium text-primary hover:underline"
                              href={`/sales/orders/${row.documentId}`}
                            >
                              {label(row.name)}
                            </Link>
                          ) : (
                            <button
                              className="line-clamp-2 text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2"
                              onClick={() => openRow(row)}
                            >
                              {label(row.name)}
                            </button>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {input.view === "products"
                              ? row.sku
                              : ["documents", "costGaps"].includes(input.view)
                                ? `${row.date} · ${t(row.kind === "return" ? "returnDocument" : "saleDocument")}`
                                : ""}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(row.netSalesKgs)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(row.costKgs)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {money(row.grossProfitKgs)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {percent(row.marginPercent)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(row.returnsKgs)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {input.view === "products"
                          ? `${number(row.netQuantity)} ${row.unit ?? ""}`
                          : number(row.receiptCount)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.unknownCostLines ? (
                          <span className="text-amber-700 dark:text-amber-300">
                            {t("missingCount", { count: row.unknownCostLines })}
                          </span>
                        ) : row.zeroCostLines ? (
                          t("zeroConfirmed")
                        ) : (
                          t("complete")
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/40 font-semibold">
                    <TableCell>
                      {t(input.view === "costGaps" ? "filteredTotals" : "total")}
                    </TableCell>
                    <TableCell className="text-right">{money(totals.netSalesKgs)}</TableCell>
                    <TableCell className="text-right">{money(totals.costKgs)}</TableCell>
                    <TableCell className="text-right">{money(totals.grossProfitKgs)}</TableCell>
                    <TableCell className="text-right">{percent(totals.marginPercent)}</TableCell>
                    <TableCell className="text-right">{money(totals.returnsKgs)}</TableCell>
                    <TableCell className="text-right">
                      {input.view === "products" ? "—" : number(totals.receiptCount)}
                    </TableCell>
                    <TableCell>{percent(totals.coveragePercent)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            ) : (
              <div className="space-y-3 p-10 text-center">
                <h3 className="font-medium">
                  {t(input.view === "costGaps" ? "noCostGaps" : "emptyPeriod")}
                </h3>
                <p className="text-sm text-muted-foreground">{t("emptyHelp")}</p>
                <Button
                  variant="secondary"
                  onClick={() =>
                    update({
                      search: undefined,
                      category: undefined,
                      productId: undefined,
                      variantKey: undefined,
                      customerKey: undefined,
                      documentId: undefined,
                      kind: undefined,
                    })
                  }
                >
                  {t("reset")}
                </Button>
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
            <summary className="cursor-pointer font-medium">{t("methodology")}</summary>
            <div className="mt-3 max-w-4xl space-y-2 leading-6 text-muted-foreground">
              <p>{t("salesMethod")}</p>
              <p>{t("costMethod")}</p>
              <p>{t("profitMethod")}</p>
              <p>{t("categoryMethod")}</p>
              <p>{t("quantityMethod")}</p>
            </div>
          </details>
        </>
      )}
      {preview && (
        <ReceiptPreviewModal
          saleId={preview}
          open
          onOpenChange={(open) => {
            if (!open) setPreview(null);
          }}
        />
      )}
    </div>
  );
}
function AnalyticsAudience() {
  const { data: session } = useSession();
  return (
    <AnalyticsReportContent
      key={`${session?.user.id}:${session?.user.organizationId}:${session?.user.role}`}
    />
  );
}
export default function AnalyticsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <AnalyticsAudience />
    </Suspense>
  );
}
