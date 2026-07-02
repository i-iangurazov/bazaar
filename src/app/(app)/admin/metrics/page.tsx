"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { baseAccountingCurrency, formatKgsMoney } from "@/lib/currencyDisplay";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const allValue = "__all__";
const pageSize = 25;

type WarningFilter =
  | "all"
  | "noCost"
  | "noPrice"
  | "noImage"
  | "negativeStock"
  | "lowStock"
  | "unassigned";

type SortKey =
  | "retailValue"
  | "costValue"
  | "profit"
  | "stockQty"
  | "margin"
  | "product"
  | "store"
  | "warnings";

type SortDirection = "asc" | "desc";

const warningOptionDefs: Array<{
  value: WarningFilter;
}> = [
  { value: "all" },
  { value: "noCost" },
  { value: "noPrice" },
  { value: "noImage" },
  { value: "negativeStock" },
  { value: "lowStock" },
  { value: "unassigned" },
];

const sortOptionDefs: Array<{ value: SortKey }> = [
  { value: "retailValue" },
  { value: "costValue" },
  { value: "profit" },
  { value: "stockQty" },
  { value: "margin" },
  { value: "warnings" },
  { value: "product" },
  { value: "store" },
];

const moneyOptions = { maximumFractionDigits: 0 };
const priceOptions = { maximumFractionDigits: 2 };

const MetricSkeleton = () => (
  <Card>
    <CardHeader>
      <Skeleton className="h-4 w-32" />
    </CardHeader>
    <CardContent className="space-y-3">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-3 w-full max-w-56" />
    </CardContent>
  </Card>
);

const EmptyTableRow = ({ colSpan, label }: { colSpan: number; label: string }) => (
  <TableRow>
    <TableCell colSpan={colSpan} className="h-24 text-center text-sm text-muted-foreground">
      {label}
    </TableCell>
  </TableRow>
);

const AdminMetricsPage = () => {
  const t = useTranslations("adminMetrics");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const isForbidden = status === "authenticated" && !isAdmin;

  const [storeId, setStoreId] = useState(allValue);
  const [category, setCategory] = useState(allValue);
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [warning, setWarning] = useState<WarningFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("retailValue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());

  const queryInput = useMemo(
    () => ({
      storeId: storeId === allValue ? undefined : storeId,
      category: category === allValue ? undefined : category,
      search: deferredSearch || undefined,
      includeArchived,
      warning,
      sortKey,
      sortDirection,
      page,
      pageSize,
    }),
    [category, deferredSearch, includeArchived, page, sortDirection, sortKey, storeId, warning],
  );

  const metricsQuery = trpc.adminMetrics.get.useQuery(queryInput, {
    enabled: Boolean(isAdmin),
    keepPreviousData: true,
  });

  const data = metricsQuery.data;
  const inventory = data?.inventory;
  const summary = inventory?.summary;
  const pagination = inventory?.products.pagination;

  const warningLabels = useMemo(
    () =>
      ({
        noCost: t("warnings.noCost"),
        noPrice: t("warnings.noPrice"),
        noImage: t("warnings.noImage"),
        negativeStock: t("warnings.negativeStock"),
        lowStock: t("warnings.lowStock"),
        unassigned: t("warnings.unassigned"),
      }) satisfies Record<Exclude<WarningFilter, "all">, string>,
    [t],
  );

  const warningOptions = useMemo(
    () =>
      warningOptionDefs.map((option) => ({
        value: option.value,
        label:
          option.value === "all"
            ? t("warnings.all")
            : warningLabels[option.value as Exclude<WarningFilter, "all">],
        description: t(`warningDescriptions.${option.value}`),
      })),
    [t, warningLabels],
  );

  const sortOptions = useMemo(
    () =>
      sortOptionDefs.map((option) => ({
        value: option.value,
        label: t(`sort.${option.value}`),
      })),
    [t],
  );

  useEffect(() => {
    if (pagination && page > pagination.totalPages) {
      setPage(pagination.totalPages);
    }
  }, [page, pagination]);

  const resetPage = () => setPage(1);
  const selectedStoreName =
    storeId === allValue
      ? t("filters.allStores")
      : data?.filterOptions.stores.find((store) => store.id === storeId)?.name ??
        t("filters.storeFallback");

  const formatMoney = (value: number) =>
    formatKgsMoney(value, locale, baseAccountingCurrency, moneyOptions);
  const formatPrice = (value: number | null | undefined) =>
    value === null || value === undefined
      ? tCommon("notAvailable")
      : formatKgsMoney(value, locale, baseAccountingCurrency, priceOptions);
  const formatNullableMoney = (value: number | null | undefined) =>
    value === null || value === undefined ? tCommon("notAvailable") : formatMoney(value);
  const formatQty = (value: number | null | undefined) =>
    formatNumber(value ?? 0, locale, { maximumFractionDigits: 2 });
  const formatInteger = (value: number | null | undefined) =>
    formatNumber(value ?? 0, locale, { maximumFractionDigits: 0 });
  const formatPercent = (value: number | null | undefined) =>
    value === null || value === undefined
      ? tCommon("notAvailable")
      : `${formatNumber(value, locale, { maximumFractionDigits: 1 })}%`;

  const warningCards = summary
    ? warningOptions
        .filter((option) => option.value !== "all")
        .map((option) => ({
          ...option,
          count: summary.warningCounts[option.value as Exclude<WarningFilter, "all">],
        }))
    : [];

  if (isForbidden) {
    return (
      <div>
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
        />
        <p className="mt-4 text-sm text-danger">{tErrors("forbidden")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />

      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-muted-foreground">
              {t("filters.store")}
            </label>
            <Select
              value={storeId}
              onValueChange={(value) => {
                setStoreId(value);
                resetPage();
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("filters.allStores")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={allValue}>{t("filters.allStores")}</SelectItem>
                {data?.filterOptions.stores.map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-muted-foreground">
              {t("filters.category")}
            </label>
            <Select
              value={category}
              onValueChange={(value) => {
                setCategory(value);
                resetPage();
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("filters.allCategories")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={allValue}>{t("filters.allCategories")}</SelectItem>
                {data?.filterOptions.categories.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 xl:col-span-2">
            <label className="text-xs font-medium uppercase text-muted-foreground">
              {t("filters.productSearch")}
            </label>
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                resetPage();
              }}
              placeholder={t("filters.searchPlaceholder")}
            />
          </div>

          <div className="flex items-end">
            <label className="flex min-h-10 w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block font-medium">{t("filters.archived")}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t("filters.archivedDescription")}
                </span>
              </span>
              <Switch
                checked={includeArchived}
                onCheckedChange={(checked) => {
                  setIncludeArchived(Boolean(checked));
                  resetPage();
                }}
                aria-label={t("filters.archivedAria")}
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {metricsQuery.isLoading && !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <MetricSkeleton key={index} />
          ))}
        </div>
      ) : data && inventory && summary ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("kpi.totalQty")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tracking-normal">
                  {formatQty(summary.totalStockQty)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("kpi.totalQtyHint", { store: selectedStoreName })}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("kpi.costValue")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tracking-normal">
                  {formatMoney(summary.costValueKgs)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("kpi.noCostHint", { count: formatInteger(summary.warningCounts.noCost) })}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("kpi.retailValue")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tracking-normal">
                  {formatMoney(summary.retailValueKgs)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("kpi.noPriceHint", { count: formatInteger(summary.warningCounts.noPrice) })}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("kpi.profit")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tracking-normal">
                  {formatMoney(summary.potentialGrossProfitKgs)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("kpi.profitHint")}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("kpi.margin")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tracking-normal">
                  {formatPercent(summary.potentialMarginPercent)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("kpi.marginHint", { count: formatInteger(summary.rowsWithProfitData) })}
                </p>
              </CardContent>
            </Card>
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{t("attention.title")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("attention.subtitle")}
                </p>
              </div>
              {metricsQuery.isFetching ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="h-3.5 w-3.5" />
                  {t("attention.updating")}
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              {warningCards.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    setWarning(item.value);
                    resetPage();
                  }}
                  className={cn(
                    "rounded-md border bg-card p-3 text-left shadow-sm transition hover:border-primary/60 hover:bg-accent/40",
                    warning === item.value ? "border-primary ring-2 ring-primary/15" : "border-border",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm font-semibold">{item.label}</span>
                    <Badge variant={item.count > 0 ? "warning" : "success"}>
                      {formatInteger(item.count)}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{item.description}</p>
                </button>
              ))}
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>{t("sections.byStores")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("columns.store")}</TableHead>
                        <TableHead>{t("columns.stock")}</TableHead>
                        <TableHead>{t("columns.costValue")}</TableHead>
                        <TableHead>{t("columns.retailValue")}</TableHead>
                        <TableHead>{t("columns.profit")}</TableHead>
                        <TableHead>{t("columns.issues")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inventory.storeSummaries.length ? (
                        inventory.storeSummaries.map((store) => (
                          <TableRow key={store.storeId}>
                            <TableCell className="font-medium">{store.storeName}</TableCell>
                            <TableCell>{formatQty(store.totalStockQty)}</TableCell>
                            <TableCell>{formatMoney(store.costValueKgs)}</TableCell>
                            <TableCell>{formatMoney(store.retailValueKgs)}</TableCell>
                            <TableCell>
                              <div className="font-medium">
                                {formatMoney(store.potentialGrossProfitKgs)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatPercent(store.potentialMarginPercent)}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {store.warningCounts.negativeStock > 0 ? (
                                  <Badge variant="danger">
                                    -{formatInteger(store.warningCounts.negativeStock)}
                                  </Badge>
                                ) : null}
                                {store.warningCounts.noCost > 0 ? (
                                  <Badge variant="warning">
                                    {t("badges.costShort", {
                                      count: formatInteger(store.warningCounts.noCost),
                                    })}
                                  </Badge>
                                ) : null}
                                {store.warningCounts.noPrice > 0 ? (
                                  <Badge variant="warning">
                                    {t("badges.priceShort", {
                                      count: formatInteger(store.warningCounts.noPrice),
                                    })}
                                  </Badge>
                                ) : null}
                                {store.warningCounts.negativeStock === 0 &&
                                store.warningCounts.noCost === 0 &&
                                store.warningCounts.noPrice === 0 ? (
                                  <Badge variant="success">{t("badges.ok")}</Badge>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <EmptyTableRow colSpan={6} label={t("table.emptyStock")} />
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("sections.sales30d")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">{t("sales.revenue")}</span>
                  <span className="font-semibold">{formatMoney(data.sales30d.revenueKgs)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">{t("sales.receipts")}</span>
                  <span className="font-semibold">{formatInteger(data.sales30d.orders)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">{t("sales.soldQty")}</span>
                  <span className="font-semibold">{formatQty(data.sales30d.soldQty)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">{t("sales.grossProfit")}</span>
                  <span className="font-semibold">{formatMoney(data.sales30d.grossProfitKgs)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">{t("sales.margin")}</span>
                  <span className="font-semibold">{formatPercent(data.sales30d.grossMarginPercent)}</span>
                </div>
                <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                  {t("sales.note")}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("sections.byCategories")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table className="min-w-[820px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("columns.category")}</TableHead>
                      <TableHead>{t("columns.products")}</TableHead>
                      <TableHead>{t("columns.stock")}</TableHead>
                      <TableHead>{t("columns.costValue")}</TableHead>
                      <TableHead>{t("columns.retailValue")}</TableHead>
                      <TableHead>{t("columns.profit")}</TableHead>
                      <TableHead>{t("columns.margin")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventory.categorySummaries.length ? (
                      inventory.categorySummaries.map((item) => (
                        <TableRow key={item.category}>
                          <TableCell className="font-medium">{item.category}</TableCell>
                          <TableCell>{formatInteger(item.productCount)}</TableCell>
                          <TableCell>{formatQty(item.totalStockQty)}</TableCell>
                          <TableCell>{formatMoney(item.costValueKgs)}</TableCell>
                          <TableCell>{formatMoney(item.retailValueKgs)}</TableCell>
                          <TableCell>{formatMoney(item.potentialGrossProfitKgs)}</TableCell>
                          <TableCell>{formatPercent(item.potentialMarginPercent)}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <EmptyTableRow colSpan={7} label={t("table.emptyCategories")} />
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle>{t("sections.productValues")}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {pagination
                    ? t("table.productRowsSummary", {
                        count: formatInteger(pagination.totalItems),
                        page: formatInteger(pagination.page),
                        totalPages: formatInteger(pagination.totalPages),
                      })
                    : t("table.productRowsFallback")}
                </p>
              </div>
              <div className="grid w-full gap-2 sm:grid-cols-3 lg:w-auto">
                <Select
                  value={warning}
                  onValueChange={(value) => {
                    setWarning(value as WarningFilter);
                    resetPage();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {warningOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={sortKey}
                  onValueChange={(value) => {
                    setSortKey(value as SortKey);
                    resetPage();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sortOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={sortDirection}
                  onValueChange={(value) => {
                    setSortDirection(value as SortDirection);
                    resetPage();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">{t("table.descending")}</SelectItem>
                    <SelectItem value="asc">{t("table.ascending")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table className="min-w-[1180px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("columns.product")}</TableHead>
                      <TableHead>{t("columns.skuBarcode")}</TableHead>
                      <TableHead>{t("columns.store")}</TableHead>
                      <TableHead>{t("columns.category")}</TableHead>
                      <TableHead>{t("columns.stock")}</TableHead>
                      <TableHead>{t("columns.cost")}</TableHead>
                      <TableHead>{t("columns.price")}</TableHead>
                      <TableHead>{t("columns.costValue")}</TableHead>
                      <TableHead>{t("columns.retailValue")}</TableHead>
                      <TableHead>{t("columns.profit")}</TableHead>
                      <TableHead>{t("columns.margin")}</TableHead>
                      <TableHead>{t("columns.warnings")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventory.products.rows.length ? (
                      inventory.products.rows.map((product) => (
                        <TableRow key={product.snapshotId}>
                          <TableCell>
                            <div className="max-w-[240px]">
                              <p className="truncate font-medium">{product.productName}</p>
                              {product.variantName ? (
                                <p className="truncate text-xs text-muted-foreground">
                                  {product.variantName}
                                </p>
                              ) : null}
                              {product.isArchived ? (
                                <Badge variant="muted" className="mt-1">
                                  {t("table.archive")}
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-[160px] text-sm">
                              <p className="truncate">
                                {product.variantSku ?? product.productSku ?? t("table.noSku")}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {product.barcode ?? t("table.noBarcode")}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>{product.storeName}</TableCell>
                          <TableCell>{product.category}</TableCell>
                          <TableCell>
                            <span className={product.stockQty < 0 ? "font-semibold text-danger" : ""}>
                              {formatQty(product.stockQty)}
                            </span>
                          </TableCell>
                          <TableCell>{formatPrice(product.costPriceKgs)}</TableCell>
                          <TableCell>{formatPrice(product.salePriceKgs)}</TableCell>
                          <TableCell>{formatNullableMoney(product.costValueKgs)}</TableCell>
                          <TableCell>{formatNullableMoney(product.retailValueKgs)}</TableCell>
                          <TableCell>{formatNullableMoney(product.potentialProfitKgs)}</TableCell>
                          <TableCell>{formatPercent(product.marginPercent)}</TableCell>
                          <TableCell>
                            {product.warnings.length ? (
                              <div className="flex max-w-[220px] flex-wrap gap-1">
                                {product.warnings.map((item) =>
                                  item === "all" ? null : (
                                    <Badge
                                      key={item}
                                      variant={item === "negativeStock" ? "danger" : "warning"}
                                    >
                                      {warningLabels[item]}
                                    </Badge>
                                  ),
                                )}
                              </div>
                            ) : (
                              <Badge variant="success">{t("badges.ok")}</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <EmptyTableRow colSpan={12} label={t("table.emptyProducts")} />
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  {data?.generatedAt
                    ? t("table.snapshotUpdated", {
                        date: formatDateTime(data.generatedAt, locale),
                        ms: formatInteger(data.queryTimingMs),
                      })
                    : t("table.dataUpdating")}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!pagination?.hasPreviousPage}
                    onClick={() => setPage((current) => Math.max(current - 1, 1))}
                  >
                    {t("table.previous")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!pagination?.hasNextPage}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    {t("table.next")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>
      )}
    </div>
  );
};

export default AdminMetricsPage;
