"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader } from "@/components/page-header";
import { QueryErrorState } from "@/components/query-error-state";
import { ShiftReportPreview } from "@/components/reports/shift-report-preview";
import { ReceiptPreviewModal } from "@/components/pos/receipt-preview-modal";
import { ReportMetric } from "@/components/reports/report-metric";
import {
  ReportTable as Table,
  ReportPagination,
  ReportPeriodControls,
  ReportSelect,
  useReportScope,
} from "@/components/reports/report-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { reportHref, operationViews, type OperationView } from "@/lib/reporting";
import { baseAccountingCurrency, formatKgsMoney } from "@/lib/currencyDisplay";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { downloadTableFile, type DownloadFormat } from "@/lib/fileExport";
import { reportError } from "@/lib/reporting";
import type { OperationRow } from "@/server/services/reporting/operations";

function ReportsContent() {
  const scope = useReportScope("hub"),
    t = useTranslations("reporting"),
    errors = useTranslations("errors"),
    locale = useLocale();
  const { state, enabled, update } = scope;
  const utils = trpc.useUtils();
  const overview = state.view === "overview";
  const [format, setFormat] = useState<DownloadFormat>("csv"),
    [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<{ fingerprint: string; text: string } | null>(
    null,
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [shiftPreview, setShiftPreview] = useState<string | null>(null);
  const period = { dateFrom: state.dateFrom, dateTo: state.dateTo, storeId: state.storeId };
  const sales = trpc.reports.sales.useQuery(
    { ...period, channel: "all", view: "stores", pageSize: 1 },
    { enabled: enabled && overview, staleTime: 0, cacheTime: 0, retry: false },
  );
  const input = {
    ...period,
    view: (overview ? "stock" : state.view) as OperationView,
    search: scope.search.trim() || undefined,
    sort: state.sort as "date" | "amount" | "name",
    direction: state.direction,
    page: state.page,
    pageSize: 25,
  };
  const operations = trpc.reports.operations.useQuery(input, {
    enabled: enabled && !overview,
    keepPreviousData: false,
    staleTime: 0,
    cacheTime: 0,
    retry: false,
  });
  const summary = enabled && !sales.error ? sales.data : undefined;
  const data = enabled && !operations.error ? operations.data : undefined;
  const moneyFlow = state.view === "payments" || state.view === "cash";
  const currentSnapshot = ["stock", "stockouts", "debts"].includes(state.view);
  const money = (value: number | null | undefined) =>
    value === null || value === undefined
      ? "—"
      : formatKgsMoney(value, locale, baseAccountingCurrency);
  const number = (value: number | null | undefined) =>
    value === null || value === undefined
      ? "—"
      : formatNumber(value, locale, { maximumFractionDigits: 2 });
  const name = (value: string) => (value.startsWith("__") ? t(`special.${value}`) : value);
  const salesLink = (view: string) =>
    reportHref("/reports/analytics", { ...period, channel: "all", view });
  const openOperation = (row: OperationRow) => {
    if (row.referenceType === "SALE") setPreview(row.documentId);
    if (row.referenceType === "SHIFT") setShiftPreview(row.documentId);
  };
  const rowHref = (row: OperationRow) =>
    row.referenceType === "PURCHASE_ORDER" && row.documentId
      ? `/purchase-orders/${row.documentId}`
      : row.documentId &&
          ["STOCK_RECEIVING", "TRANSFER", "WRITE_OFF", "STOCK_COUNT"].includes(
            row.referenceType ?? "",
          )
        ? `/inventory/movements/${encodeURIComponent(`${row.referenceType}:${row.referenceType}:${row.documentId}`)}?${new URLSearchParams({ returnTo: reportHref("/reports", { ...state, valid: undefined, search: scope.search || undefined }) })}`
        : row.productId
          ? `/products/${row.productId}`
          : row.referenceType === "SUPPLIER" && row.id !== "__unassigned__"
            ? `/suppliers?q=${encodeURIComponent(row.name)}`
            : null;
  const exportTable = async () => {
    if (!enabled || exporting) return;
    const guard = scope.exportGuard();
    setExporting(true);
    setExportError(null);
    try {
      const result = await utils.client.reports.operationsExport.query({
        ...input,
        page: undefined,
        pageSize: undefined,
      });
      if (!guard()) return;
      await downloadTableFile({
        format,
        fileNameBase: `${state.view}-all-filtered-${state.dateFrom}-${state.dateTo}`,
        header: [
          t("name"),
          t("date"),
          t("store"),
          t("operation"),
          t("quantity"),
          t("unit"),
          `${t("amount")} KGS`,
          t("unknownLines"),
        ],
        rows: [
          ...result.items.map((row) => [
            name(row.name),
            row.date ? formatDateTime(new Date(row.date), locale) : "",
            row.storeName,
            t(`kinds.${row.kind}`),
            row.quantity === null ? "" : String(row.quantity),
            row.unit ?? "",
            row.amountKgs === null ? t("unknown") : String(row.amountKgs),
            String(row.unknownRows),
          ]),
          [
            t("total"),
            "",
            "",
            "",
            "",
            "",
            result.summary.amountKgs === null ? t("unknown") : String(result.summary.amountKgs),
            String(result.summary.unknownRows),
          ],
          [
            t("context"),
            result.meta.currentSnapshot
              ? t("currentSnapshot")
              : `${state.dateFrom} – ${state.dateTo}`,
            state.storeId ?? t("allStores"),
            scope.search,
            formatDateTime(result.meta.generatedAt, locale),
            "Asia/Bishkek",
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
      <PageHeader
        title={t("reportCenter")}
        subtitle={[
          overview ? summary?.meta.organizationName : data?.meta.organizationName,
          t("hubSubtitle"),
        ]
          .filter(Boolean)
          .join(" · ")}
        action={
          <Button asChild>
            <Link href={salesLink("products")}>{t("openAnalytics")}</Link>
          </Button>
        }
      />
      <ReportPeriodControls scope={scope} currentSnapshot={currentSnapshot}>
        <ReportSelect
          label={t("report")}
          value={state.view}
          onChange={(view) => update({ view, search: undefined, sort: "date" })}
        >
          {["overview", ...operationViews].map((view) => (
            <option key={view} value={view}>
              {t(`operations.${view}`)}
            </option>
          ))}
        </ReportSelect>
      </ReportPeriodControls>
      {scope.error && (
        <p role="alert" className="rounded-xl border border-danger/30 p-4 text-sm text-danger">
          {scope.error}
        </p>
      )}
      {enabled && (overview ? sales.error : operations.error) && (
        <QueryErrorState onRetry={() => void (overview ? sales.refetch() : operations.refetch())} />
      )}
      {enabled && (overview ? sales.isLoading : operations.isLoading) && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[1, 2, 3, 4].map((key) => (
            <Skeleton key={key} className="h-36" />
          ))}
        </div>
      )}
      {overview && summary && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <ReportMetric
              title={t("netSales")}
              value={money(summary.totals.netSalesKgs)}
              note={t("netSalesNote")}
              accent
            />
            <ReportMetric
              title={t("cost")}
              value={money(summary.totals.costKgs)}
              note={
                summary.totals.unknownCostLines
                  ? t("partialCost", {
                      count: summary.totals.unknownCostLines,
                      amount: money(summary.totals.knownCostKgs),
                    })
                  : t("costNote")
              }
            />
            <ReportMetric
              title={t("profit")}
              value={money(summary.totals.grossProfitKgs)}
              note={t("profitNote")}
            />
            <ReportMetric
              title={t("returns")}
              value={money(summary.totals.returnsKgs)}
              note={t("inspectReturns", { count: summary.totals.returnCount })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("updated", { date: formatDateTime(summary.meta.generatedAt, locale) })} ·{" "}
            {t("channels.all")}
          </p>
          <div className="grid gap-4 xl:grid-cols-3">
            {[
              {
                title: "salesGroup",
                note: "salesGroupNote",
                links: ["products", "categories", "stores", "staff", "customers", "costGaps"],
              },
              {
                title: "stockGroup",
                note: "stockGroupNote",
                links: [
                  "stock",
                  "stockouts",
                  "slowMovers",
                  "writeOffs",
                  "movements",
                  "receipts",
                  "suppliers",
                ],
              },
              { title: "moneyGroup", note: "moneyGroupNote", links: ["payments", "cash", "debts"] },
            ].map((group) => (
              <section key={group.title} className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-lg font-semibold">{t(group.title)}</h2>
                <p className="mt-2 min-h-12 text-sm leading-6 text-muted-foreground">
                  {t(group.note)}
                </p>
                <div className="mt-4 divide-y divide-border">
                  {group.links.map((view) => (
                    <Link
                      key={view}
                      className="flex min-h-12 items-center justify-between gap-3 py-3 text-sm font-medium hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                      href={
                        group.title === "salesGroup"
                          ? salesLink(view)
                          : reportHref("/reports", { ...period, channel: "all", view })
                      }
                    >
                      {t(`${group.title === "salesGroup" ? "views" : "operations"}.${view}`)}
                      <span aria-hidden>↗</span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5">
            <div>
              <h2 className="font-semibold">{t("documentsAndControl")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("documentsAndControlNote")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                ["/reports/receipts", "receiptRegister"],
                ["/pos/shifts", "shifts"],
                ["/reports/close", "closePeriod"],
                ["/reports/exports", "exportHistory"],
              ].map(([href, label]) => (
                <Button key={href} asChild variant="secondary">
                  <Link href={href}>{t(label)}</Link>
                </Button>
              ))}
              {scope.session?.user.role === "ADMIN" && (
                <Button asChild variant="secondary">
                  <Link
                    href={
                      state.storeId ? `/admin/metrics?storeId=${state.storeId}` : "/admin/metrics"
                    }
                  >
                    {t("inventoryValuation")}
                  </Link>
                </Button>
              )}
            </div>
          </section>
        </>
      )}
      {!overview && data && (
        <>
          <section className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{t(`operations.${state.view}`)}</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {t(`operationNotes.${state.view}`)}
                </p>
              </div>
              <Button
                variant="secondary"
                disabled={operations.isFetching}
                onClick={() => void operations.refetch()}
              >
                {t("refresh")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("updated", { date: formatDateTime(data.meta.generatedAt, locale) })}
            </p>
          </section>
          <div className="grid gap-3 sm:grid-cols-3">
            <ReportMetric
              title={t(
                currentSnapshot
                  ? state.view !== "debts"
                    ? "inventoryCost"
                    : "debtTotal"
                  : "amount",
              )}
              value={money(data.summary.amountKgs)}
              note={
                state.view === "movements"
                  ? t("movementAmounts")
                  : data.summary.unknownRows
                    ? t("partialCost", {
                        count: data.summary.unknownRows,
                        amount: money(data.summary.knownAmountKgs),
                      })
                    : t(currentSnapshot ? "currentSnapshot" : "selectedPeriod")
              }
              accent
            />
            <ReportMetric
              title={t(moneyFlow ? "moneyIn" : "records")}
              value={moneyFlow ? money(data.summary.inflowKgs) : number(data.summary.count)}
              note={t("allFiltered")}
            />
            <ReportMetric
              title={t(
                moneyFlow ? "moneyOut" : state.view === "stock" ? "negativeStock" : "unknownLines",
              )}
              value={
                moneyFlow
                  ? money(data.summary.outflowKgs)
                  : number(
                      state.view === "stock"
                        ? data.summary.negativeStock
                        : data.summary.unknownRows,
                    )
              }
              note={t(
                moneyFlow
                  ? "selectedPeriod"
                  : state.view === "stock"
                    ? "stockAttention"
                    : "noGuessCost",
              )}
            />
          </div>
          {data.breakdown.length > 0 && (
            <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {data.breakdown.map((row) => (
                <div key={row.kind} className="rounded-lg border border-border bg-card p-4">
                  <dt className="text-xs text-muted-foreground">{t(`kinds.${row.kind}`)}</dt>
                  <dd className="mt-2 font-semibold tabular-nums">{money(row.amountKgs)}</dd>
                  <dd className="mt-1 text-xs text-muted-foreground">
                    {t("recordsCount", { count: row.count })}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
            <div className="grid items-end gap-3 border-b border-border p-4 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_180px_180px_100px_auto]">
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                {t("search")}
                <Input
                  aria-label={t("search")}
                  value={scope.search}
                  placeholder={t("operationSearch")}
                  onChange={(event) => scope.setSearch(event.target.value)}
                  onBlur={() => {
                    if ((state.search ?? "") !== scope.search)
                      update({ search: scope.search || undefined });
                  }}
                />
              </label>
              <ReportSelect
                label={t("sort")}
                value={state.sort}
                onChange={(sort) => update({ sort })}
              >
                {["date", "amount", "name"].map((sort) => (
                  <option key={sort} value={sort}>
                    {t(`sorts.${sort}`)}
                  </option>
                ))}
              </ReportSelect>
              <ReportSelect
                label={t("direction")}
                value={state.direction}
                onChange={(direction) => update({ direction })}
              >
                <option value="desc">{t("descending")}</option>
                <option value="asc">{t("ascending")}</option>
              </ReportSelect>
              <ReportSelect
                label={t("format")}
                value={format}
                onChange={(value) => setFormat(value as DownloadFormat)}
              >
                <option value="csv">{"CSV"}</option>
                <option value="xlsx">{"XLSX"}</option>
              </ReportSelect>
              <Button variant="secondary" disabled={exporting} onClick={() => void exportTable()}>
                {t(exporting ? "exporting" : "exportAll")}
              </Button>
            </div>
            {exportError?.fingerprint === scope.fingerprint && (
              <p role="alert" className="p-4 text-sm text-danger">
                {exportError.text}
              </p>
            )}
            {data.items.length ? (
              <Table sortable={false} className="min-w-[960px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("name")}</TableHead>
                    <TableHead>{t("date")}</TableHead>
                    <TableHead>{t("store")}</TableHead>
                    <TableHead>{t("operation")}</TableHead>
                    <TableHead className="text-right">{t("quantity")}</TableHead>
                    <TableHead className="text-right">{t("amount")} · KGS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((row) => {
                    const href = rowHref(row);
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="w-72 min-w-[14rem] max-w-80 sm:min-w-[18rem]">
                          {href ? (
                            <Link className="font-medium text-primary hover:underline" href={href}>
                              {name(row.name)}
                            </Link>
                          ) : ["SALE", "SHIFT"].includes(row.referenceType ?? "") ? (
                            <button
                              className="text-left font-medium text-primary hover:underline"
                              onClick={() => openOperation(row)}
                            >
                              {name(row.name)}
                            </button>
                          ) : (
                            name(row.name)
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {row.date ? formatDateTime(new Date(row.date), locale) : "—"}
                        </TableCell>
                        <TableCell>{row.storeName || "—"}</TableCell>
                        <TableCell className="text-xs">{t(`kinds.${row.kind}`)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.quantity === null
                            ? "—"
                            : `${number(row.quantity)} ${row.unit ?? ""}`}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(row.amountKgs)}
                          {row.unknownRows > 0 && (
                            <span className="block text-xs text-amber-700 dark:text-amber-300">
                              {t("missingCount", { count: row.unknownRows })}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/40 font-semibold">
                    <TableCell colSpan={5}>{t("total")}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(data.summary.amountKgs)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            ) : (
              <div className="space-y-3 p-10 text-center">
                <h3 className="font-medium">{t("emptyPeriod")}</h3>
                <p className="text-sm text-muted-foreground">{t("emptyHelp")}</p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    scope.setSearch("");
                    update({ search: undefined });
                  }}
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
        </>
      )}
      {shiftPreview && (
        <ShiftReportPreview shiftId={shiftPreview} onClose={() => setShiftPreview(null)} />
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
function ReportsAudience() {
  const { data: session } = useSession();
  return (
    <ReportsContent
      key={`${session?.user.id}:${session?.user.organizationId}:${session?.user.role}`}
    />
  );
}
export default function ReportsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ReportsAudience />
    </Suspense>
  );
}
