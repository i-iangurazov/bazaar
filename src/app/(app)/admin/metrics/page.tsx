"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader } from "@/components/page-header";
import { QueryErrorState } from "@/components/query-error-state";
import { ReportMetric } from "@/components/reports/report-metric";
import {
  ReportTable as Table,
  ReportPagination,
  ReportSelect,
  ReportField,
} from "@/components/reports/report-controls";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { baseAccountingCurrency, formatKgsMoney } from "@/lib/currencyDisplay";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { downloadTableFile, type DownloadFormat } from "@/lib/fileExport";
import { reportError, reportHref } from "@/lib/reporting";
import { trpc } from "@/lib/trpc";
import type {
  AdminMetricsWarningFilter,
  AdminMetricsSortKey,
} from "@/server/services/adminMetrics";

const warnings = [
  "all",
  "noCost",
  "noPrice",
  "noImage",
  "negativeStock",
  "lowStock",
  "unassigned",
] as const;
const sorts = [
  "retailValue",
  "costValue",
  "profit",
  "stockQty",
  "margin",
  "product",
  "store",
  "warnings",
] as const;
function MetricsContent() {
  const t = useTranslations("adminMetrics"),
    r = useTranslations("reporting"),
    errors = useTranslations("errors"),
    locale = useLocale();
  const { data: session, status } = useSession();
  const params = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const queryString = params.toString();
  const [draft, setDraft] = useState({ key: queryString, value: params.get("search") ?? "" });
  const search = draft.key === queryString ? draft.value : (params.get("search") ?? "");
  const setSearch = (value: string) => setDraft({ key: queryString, value });
  const warning = (params.get("warning") ?? "all") as AdminMetricsWarningFilter;
  const sortKey = (params.get("sortKey") ?? "retailValue") as AdminMetricsSortKey;
  const sortDirection = (params.get("sortDirection") ?? "desc") as "asc" | "desc";
  const page = Number(params.get("page") ?? 1),
    view = params.get("view") ?? "products";
  const input = {
    storeId: params.get("storeId") ?? undefined,
    category: params.get("category") ?? undefined,
    search: search.trim() || undefined,
    includeArchived: params.get("includeArchived") === "true",
    warning,
    sortKey,
    sortDirection,
    page,
    pageSize: 25,
  };
  let valid =
    warnings.includes(warning) &&
    sorts.includes(sortKey) &&
    ["asc", "desc"].includes(sortDirection) &&
    ["products", "stores", "categories"].includes(view) &&
    Number.isInteger(page) &&
    page >= 1 &&
    page <= 1_000_000;
  params.forEach((value, key) => {
    if (
      ![
        "storeId",
        "category",
        "search",
        "includeArchived",
        "warning",
        "sortKey",
        "sortDirection",
        "page",
        "view",
      ].includes(key) ||
      params.getAll(key).length !== 1 ||
      !value ||
      value.length > 200
    )
      valid = false;
  });
  const update = (patch: Record<string, string | number | undefined>) => {
    router.replace(
      reportHref(pathname, {
        ...Object.fromEntries(params),
        search: search || undefined,
        page: undefined,
        ...patch,
      }),
      { scroll: false },
    );
  };
  const enabled = status === "authenticated" && session?.user.role === "ADMIN" && valid;
  const query = trpc.adminMetrics.get.useQuery(input, {
    enabled,
    keepPreviousData: false,
    staleTime: 0,
    cacheTime: 0,
    retry: false,
  });
  const data = enabled && !query.error ? query.data : undefined;
  // Retain only option labels while a different filtered result is loading.
  // Inventory totals still belong exclusively to the current query above.
  const optionScope = JSON.stringify([session?.user.id, session?.user.organizationId, enabled]);
  const [lastOptions, setLastOptions] = useState<{
    scope: string;
    value: NonNullable<typeof data>["filterOptions"];
  }>();
  useEffect(() => {
    if (data) setLastOptions({ scope: optionScope, value: data.filterOptions });
  }, [data, optionScope]);
  const filterOptions =
    data?.filterOptions ??
    (enabled && lastOptions?.scope === optionScope ? lastOptions.value : undefined);
  const inventory = data?.inventory,
    summary = inventory?.summary;
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
  const categoryName = (value: string) =>
    value === "Без категории" ? r("special.__uncategorized__") : value;
  const [format, setFormat] = useState<DownloadFormat>("csv"),
    [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<{ key: string; text: string } | null>(null);
  const fingerprint = JSON.stringify([
    session?.user.id,
    session?.user.organizationId,
    session?.user.role,
    status,
    queryString,
    search,
    enabled,
  ]);
  const current = useRef(fingerprint);
  current.current = fingerprint;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const utils = trpc.useUtils();
  const exportTable = async () => {
    if (!enabled || exporting) return;
    const expected = current.current,
      guard = () => mounted.current && current.current === expected;
    setExporting(true);
    setExportError(null);
    try {
      const result = await utils.client.adminMetrics.export.query({
        ...input,
        view: view as "products" | "stores" | "categories",
        page: undefined,
        pageSize: undefined,
      });
      if (!guard()) return;
      const rows =
        view === "products"
          ? result.inventory.products.rows.map((row) => [
              row.productName,
              row.variantName ?? "",
              row.productSku ?? "",
              row.storeName,
              categoryName(row.category),
              number(row.stockQty),
              money(row.costPriceKgs),
              money(row.salePriceKgs),
              money(row.costValueKgs),
              money(row.retailValueKgs),
              money(row.potentialProfitKgs),
              row.warnings.map((key) => t(`warnings.${key}`)).join(", "),
            ])
          : (view === "stores"
              ? result.inventory.storeSummaries.map((row) => ({ ...row, name: row.storeName }))
              : result.inventory.categorySummaries.map((row) => ({
                  ...row,
                  name: categoryName(row.category),
                }))
            ).map((row) => [
              row.name,
              money(row.costValueKgs),
              money(row.retailValueKgs),
              money(row.potentialGrossProfitKgs),
              number(row.warningCounts.noCost),
              number(row.warningCounts.noPrice),
            ]);
      await downloadTableFile({
        format,
        fileNameBase: `inventory-${view}-all-filtered`,
        header:
          view === "products"
            ? [
                r("name"),
                r("variant"),
                t("columns.skuBarcode"),
                r("store"),
                r("category"),
                r("quantity"),
                `${t("columns.cost")} KGS`,
                `${t("columns.price")} KGS`,
                `${r("inventoryCost")} KGS`,
                `${t("kpi.retailValue")} KGS`,
                `${t("kpi.profit")} KGS`,
                r("quality"),
              ]
            : [
                r(view === "stores" ? "store" : "category"),
                `${r("inventoryCost")} KGS`,
                `${t("kpi.retailValue")} KGS`,
                `${t("kpi.profit")} KGS`,
                t("warnings.noCost"),
                t("warnings.noPrice"),
              ],
        rows: [
          ...rows,
          [
            r("total"),
            `${r("knownCost")}: ${money(result.inventory.summary.costValueKgs)}`,
            `${t("kpi.retailValue")}: ${money(result.inventory.summary.retailValueKgs)}`,
          ],
          [
            r("context"),
            r("currentSnapshot"),
            formatDateTime(result.generatedAt, locale),
            JSON.stringify(input),
          ],
        ],
        shouldDownload: guard,
      });
    } catch (error) {
      if (guard()) setExportError({ key: expected, text: reportError(errors, error) });
    } finally {
      setExporting(false);
    }
  };
  const historicalHref = data
    ? reportHref("/reports/analytics", {
        dateFrom: data.sales30d.dateFrom,
        dateTo: data.sales30d.dateTo,
        storeId: input.storeId,
        category: input.category === "Без категории" ? "__uncategorized__" : input.category,
        search: input.search,
        channel: "all",
      })
    : "/reports/analytics";
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title={r("inventoryValuation")}
        subtitle={[data?.organizationName, r("adminPurpose")].filter(Boolean).join(" · ")}
        action={
          <>
            <Button variant="secondary" asChild>
              <Link href="/reports">{r("reportCenter")}</Link>
            </Button>
            <Button
              variant="secondary"
              disabled={!enabled || query.isFetching}
              onClick={() => void query.refetch()}
            >
              {r("refresh")}
            </Button>
          </>
        }
      />
      <section
        aria-label={r("filters")}
        className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <ReportSelect
          label={r("store")}
          value={input.storeId ?? "all"}
          onChange={(value) => update({ storeId: value === "all" ? undefined : value })}
        >
          <SelectItem value="all">{r("allStores")}</SelectItem>
          {filterOptions?.stores.map((store) => (
            <SelectItem key={store.id} value={store.id}>
              {store.name}
            </SelectItem>
          ))}
        </ReportSelect>
        <ReportSelect
          label={r("category")}
          value={input.category ?? "all"}
          onChange={(value) => update({ category: value === "all" ? undefined : value })}
        >
          <SelectItem value="all">{r("allCategories")}</SelectItem>
          {filterOptions?.categories.map((category) => (
            <SelectItem key={category} value={category}>
              {categoryName(category)}
            </SelectItem>
          ))}
        </ReportSelect>
        <ReportField label={r("search")}>
          <Input
            aria-label={r("search")}
            value={search}
            placeholder={r("searchPlaceholder")}
            onChange={(event) => setSearch(event.target.value)}
            onBlur={() => {
              if ((params.get("search") ?? "") !== search) update({ search: search || undefined });
            }}
          />
        </ReportField>
        <div className="grid min-w-0 content-start gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("filters.archived")}</span>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <Checkbox
              checked={input.includeArchived}
              onCheckedChange={(checked) =>
                update({ includeArchived: checked === true ? "true" : undefined })
              }
            />
            <span>{t("filters.archivedDescription")}</span>
          </label>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-4">
          {r("currentSnapshot")} · KGS · {r("immediate")}
        </p>
      </section>
      {!valid && (
        <p role="alert" className="text-sm text-danger">
          {errors("invalidInput")}
        </p>
      )}
      {enabled && query.error && <QueryErrorState onRetry={() => void query.refetch()} />}
      {enabled && query.isLoading && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[1, 2, 3, 4].map((key) => (
            <Skeleton key={key} className="h-36" />
          ))}
        </div>
      )}
      {data && inventory && summary && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <ReportMetric
              title={r("inventoryCost")}
              value={summary.warningCounts.noCost ? "—" : money(summary.costValueKgs)}
              note={
                summary.warningCounts.noCost
                  ? r("partialCost", {
                      count: summary.warningCounts.noCost,
                      amount: money(summary.costValueKgs),
                    })
                  : r("inventoryCostNote")
              }
              accent
            />
            <ReportMetric
              title={t("kpi.retailValue")}
              value={summary.warningCounts.noPrice ? "—" : money(summary.retailValueKgs)}
              note={t("kpi.noPriceHint", { count: number(summary.warningCounts.noPrice) })}
            />
            <ReportMetric
              title={t("kpi.profit")}
              value={
                summary.rowsWithProfitData < inventory.snapshotCount
                  ? "—"
                  : money(summary.potentialGrossProfitKgs)
              }
              note={r("potentialNote", { amount: money(summary.potentialGrossProfitKgs) })}
            />
            <ReportMetric
              title={r("inventoryRows")}
              value={number(inventory.snapshotCount)}
              note={r("inventoryRowsNote", { count: inventory.productCount })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {r("updated", { date: formatDateTime(data.generatedAt, locale) })}
          </p>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{t("attention.title")}</h2>
              {warning !== "all" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => update({ warning: undefined })}
                >
                  {r("reset")}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{r("warningScope")}</p>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
              {warnings
                .filter((key) => key !== "all")
                .map((key) => (
                  <button
                    key={key}
                    aria-pressed={warning === key}
                    onClick={() => update({ warning: warning === key ? undefined : key })}
                    className={`rounded-lg border p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${warning === key ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/50"}`}
                  >
                    <span className="block text-xs text-muted-foreground">
                      {t(`warnings.${key}`)}
                    </span>
                    <strong className="mt-2 block text-xl tabular-nums">
                      {number(summary.warningCounts[key])}
                    </strong>
                  </button>
                ))}
            </div>
          </section>
          <section className="grid gap-5 rounded-xl border border-border bg-card p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div>
              <h2 className="font-semibold">{t("sections.sales30d")}</h2>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {data.sales30d.dateFrom} — {data.sales30d.dateTo} · {r("adminSalesNote")}
              </p>
              {warning === "all" && (
                <Button asChild variant="link" className="mt-3">
                  <Link href={historicalHref}>{r("openAnalytics")} ↗</Link>
                </Button>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              {[
                [r("netSales"), money(data.sales30d.revenueKgs)],
                [r("cost"), money(data.sales30d.costKgs)],
                [r("profit"), money(data.sales30d.grossProfitKgs)],
                [r("margin"), percent(data.sales30d.grossMarginPercent)],
              ].map(([name, value]) => (
                <div key={name}>
                  <dt className="text-xs text-muted-foreground">{name}</dt>
                  <dd className="mt-2 break-words text-lg font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {data.sales30d.unknownCostLines > 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-300 lg:col-span-2">
                {r("partialProfit", { amount: money(data.sales30d.knownProfitKgs) })}{" "}
                {r("missingCount", { count: data.sales30d.unknownCostLines })}
              </p>
            )}
          </section>
          <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
            <div className="space-y-4 border-b border-border p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <nav className="flex flex-wrap gap-2" aria-label={r("dimensions")}>
                  {["products", "stores", "categories"].map((value) => (
                    <Button
                      size="sm"
                      key={value}
                      variant={view === value ? "primary" : "ghost"}
                      aria-current={view === value ? "page" : undefined}
                      onClick={() => update({ view: value })}
                    >
                      {r(`views.${value}`)}
                    </Button>
                  ))}
                </nav>
                <div className="flex items-end gap-2">
                  <ReportSelect
                    label={r("format")}
                    value={format}
                    onChange={(value) => setFormat(value as DownloadFormat)}
                  >
                    <SelectItem value="csv">{"CSV"}</SelectItem>
                    <SelectItem value="xlsx">{"XLSX"}</SelectItem>
                  </ReportSelect>
                  <Button
                    disabled={exporting}
                    variant="secondary"
                    onClick={() => void exportTable()}
                  >
                    {r(exporting ? "exporting" : "exportAll")}
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <ReportSelect
                  label={r("quality")}
                  value={warning}
                  onChange={(value) => update({ warning: value })}
                >
                  {warnings.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`warnings.${value}`)}
                    </SelectItem>
                  ))}
                </ReportSelect>
                <ReportSelect
                  label={r("sort")}
                  value={sortKey}
                  onChange={(value) => update({ sortKey: value })}
                >
                  {sorts.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`sort.${value}`)}
                    </SelectItem>
                  ))}
                </ReportSelect>
                <ReportSelect
                  label={r("direction")}
                  value={sortDirection}
                  onChange={(value) => update({ sortDirection: value })}
                >
                  <SelectItem value="desc">{r("descending")}</SelectItem>
                  <SelectItem value="asc">{r("ascending")}</SelectItem>
                </ReportSelect>
              </div>
              {(search || input.category || warning !== "all" || input.includeArchived) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    update({
                      search: undefined,
                      category: undefined,
                      warning: undefined,
                      includeArchived: undefined,
                    });
                  }}
                >
                  {r("reset")}
                </Button>
              )}
              {exportError?.key === fingerprint && (
                <p role="alert" className="text-sm text-danger">
                  {exportError.text}
                </p>
              )}
            </div>
            {view === "products" ? (
              inventory.products.rows.length ? (
                <Table sortable={false} className="min-w-[1280px]">
                  <TableHeader>
                    <TableRow>
                      {[
                        r("name"),
                        r("store"),
                        r("category"),
                        r("quantity"),
                        t("columns.cost"),
                        t("columns.price"),
                        r("inventoryCost"),
                        t("kpi.retailValue"),
                        r("quality"),
                      ].map((title, index) => (
                        <TableHead
                          key={title}
                          className={index >= 3 && index < 8 ? "text-right" : ""}
                        >
                          {title}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventory.products.rows.map((row) => (
                      <TableRow key={row.snapshotId}>
                        <TableCell className="w-72 min-w-[14rem] max-w-80 sm:min-w-[18rem]">
                          <Link
                            className="font-medium text-primary hover:underline"
                            href={`/products/${row.productId}`}
                          >
                            {row.productName}
                          </Link>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {row.variantName} · {row.variantSku ?? row.productSku}
                          </p>
                        </TableCell>
                        <TableCell>{row.storeName}</TableCell>
                        <TableCell>{categoryName(row.category)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {number(row.stockQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(row.costPriceKgs)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(row.salePriceKgs)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(row.costValueKgs)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(row.retailValueKgs)}
                        </TableCell>
                        <TableCell className="max-w-52 text-xs text-muted-foreground">
                          {row.warnings.map((key) => t(`warnings.${key}`)).join(" · ") ||
                            r("complete")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  {r("emptyPeriod")}
                </div>
              )
            ) : (
              <Table sortable={false} className="min-w-[960px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{r(view === "stores" ? "store" : "category")}</TableHead>
                    <TableHead className="text-right">{r("inventoryCost")}</TableHead>
                    <TableHead className="text-right">{t("kpi.retailValue")}</TableHead>
                    <TableHead className="text-right">{t("kpi.profit")}</TableHead>
                    <TableHead>{r("quality")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(view === "stores"
                    ? inventory.storeSummaries.map((row) => ({
                        ...row,
                        key: row.storeId,
                        name: row.storeName,
                      }))
                    : inventory.categorySummaries.map((row) => ({
                        ...row,
                        key: row.category,
                        name: categoryName(row.category),
                      }))
                  ).map((row) => (
                    <TableRow key={row.key}>
                      <TableCell>
                        <button
                          className="text-left font-medium text-primary hover:underline"
                          onClick={() =>
                            update({
                              view: "products",
                              [view === "stores" ? "storeId" : "category"]: row.key,
                            })
                          }
                        >
                          {row.name}
                        </button>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.warningCounts.noCost ? "—" : money(row.costValueKgs)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.warningCounts.noPrice ? "—" : money(row.retailValueKgs)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.warningCounts.noCost || row.warningCounts.noPrice
                          ? "—"
                          : money(row.potentialGrossProfitKgs)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r("missingCount", { count: row.warningCounts.noCost })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {view === "products" && (
              <ReportPagination
                page={page}
                pageSize={25}
                total={inventory.products.pagination.totalItems}
                onPage={(page) => update({ page })}
              />
            )}
          </section>
          <details className="rounded-xl border border-border bg-card p-4 text-sm">
            <summary className="cursor-pointer font-medium">{r("methodology")}</summary>
            <p className="mt-3 max-w-4xl leading-6 text-muted-foreground">
              {r("operationNotes.stock")} {r("potentialMethod")}
            </p>
          </details>
        </>
      )}
    </div>
  );
}
function MetricsAudience() {
  const { data: session } = useSession();
  return (
    <MetricsContent
      key={`${session?.user.id}:${session?.user.organizationId}:${session?.user.role}`}
    />
  );
}
export default function AdminMetricsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <MetricsAudience />
    </Suspense>
  );
}
