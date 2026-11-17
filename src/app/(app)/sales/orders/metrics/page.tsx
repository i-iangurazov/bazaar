"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

import { PageHeader } from "@/components/page-header";
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
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyIcon, SalesOrdersIcon } from "@/components/icons";
import { formatKgsMoney } from "@/lib/currencyDisplay";
import { formatDate } from "@/lib/i18nFormat";
import {
  formatSalesOrderMargin,
  salesOrderMetricsProfitability,
  salesOrderMetricsTrendMoney,
} from "@/lib/salesOrderMetricsDisplay";
import { businessDateKey } from "@/lib/timezone";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const SalesOrdersMetricsPage = () => {
  const t = useTranslations("salesOrders");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session } = useSession();

  const canView = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";

  const now = useMemo(() => new Date(), []);
  const initialFrom = useMemo(
    () => businessDateKey(new Date(now.getTime() - 30 * 86_400_000)),
    [now],
  );
  const initialTo = useMemo(() => businessDateKey(now), [now]);

  const [storeId, setStoreId] = useState<string>("all");
  const [employeeId, setEmployeeId] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>(initialFrom);
  const [dateTo, setDateTo] = useState<string>(initialTo);
  const [groupBy, setGroupBy] = useState<"day" | "week">("day");

  const storesQuery = trpc.stores.list.useQuery(undefined, { enabled: canView });
  const employeesQuery = trpc.salesOrders.employeeOptions.useQuery(
    storeId === "all" ? {} : { storeId },
    { enabled: canView },
  );
  const metricsQuery = trpc.salesOrders.metrics.useQuery(
    {
      ...(storeId === "all" ? {} : { storeId }),
      ...(employeeId === "all" ? {} : { employeeId }),
      fromDay: dateFrom,
      toDay: dateTo,
      groupBy,
    },
    { enabled: canView && Boolean(dateFrom) && Boolean(dateTo) },
  );

  if (!canView) {
    return (
      <div>
        <PageHeader title={t("metricsTitle")} subtitle={t("metricsSubtitle")} />
        <Card>
          <CardContent className="py-8">
            <p className="text-sm text-danger">{tErrors("forbidden")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const summary = metricsQuery.data?.summary;
  const profitability = summary ? salesOrderMetricsProfitability(summary) : null;
  const costsComplete = profitability?.costsComplete ?? true;
  const revenueSeries = metricsQuery.data?.revenueSeries ?? [];
  const profitSeries = metricsQuery.data?.profitSeries ?? [];
  const costSeries = metricsQuery.data?.costSeries ?? [];
  const topProducts = metricsQuery.data?.topProductsByRevenue ?? [];
  const topBundles = metricsQuery.data?.topBundlesByRevenue ?? [];
  const selectedStore = storeId === "all" ? null : storesQuery.data?.find((store) => store.id === storeId) ?? null;
  const formatMetricsMoney = (amountKgs: number) => formatKgsMoney(amountKgs, locale, selectedStore);
  const formatMetricOrDash = (amountKgs: number | null) =>
    amountKgs === null ? "—" : formatMetricsMoney(amountKgs);

  const seriesRows = revenueSeries.map((revenueItem, index) => ({
    date: revenueItem.date,
    revenueKgs: revenueItem.revenueKgs,
    costKgs: salesOrderMetricsTrendMoney(costSeries[index]?.costKgs ?? 0, costsComplete),
    profitKgs: salesOrderMetricsTrendMoney(profitSeries[index]?.profitKgs ?? 0, costsComplete),
  }));

  return (
    <div>
      <PageHeader
        title={t("metricsTitle")}
        subtitle={t("metricsSubtitle")}
        action={
          <Link href="/sales/orders" className="w-full sm:w-auto">
            <Button variant="secondary" className="w-full sm:w-auto">
              <SalesOrdersIcon className="h-4 w-4" aria-hidden />
              {t("title")}
            </Button>
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("metricsFiltersTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger aria-label={t("store")}>
                <SelectValue placeholder={t("store")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tCommon("allStores")}</SelectItem>
                {(storesQuery.data ?? []).map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger aria-label={t("employeeFilter")}>
                <SelectValue placeholder={t("employeeFilter")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allEmployees")}</SelectItem>
                {(employeesQuery.data ?? []).map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              aria-label={t("dateFrom")}
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              aria-label={t("dateTo")}
            />
            <Select value={groupBy} onValueChange={(value) => setGroupBy(value as "day" | "week")}>
              <SelectTrigger aria-label={t("metricsGroupBy")}> 
                <SelectValue placeholder={t("metricsGroupBy")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">{t("metricsGroupDay")}</SelectItem>
                <SelectItem value="week">{t("metricsGroupWeek")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      <p className="mt-3 text-sm text-muted-foreground">{t("metricsPeriodHint")}</p>
      {storeId === "all" ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("metricsBaseCurrencyNotice")}
        </p>
      ) : null}

      {metricsQuery.isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {tCommon("loading")}
        </div>
      ) : null}

      {metricsQuery.error ? (
        <p className="mt-4 text-sm text-danger">{translateError(tErrors, metricsQuery.error)}</p>
      ) : null}

      {summary ? (
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">{t("metricsRevenue")}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatMetricsMoney(summary.totalRevenueKgs)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">{t("metricsCost")}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatMetricOrDash(profitability?.costKgs ?? null)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">{t("metricsProfit")}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatMetricOrDash(profitability?.profitKgs ?? null)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">{t("metricsOrdersCount")}</p>
              <p className="text-lg font-semibold text-foreground">{summary.ordersCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">{t("metricsAvgOrder")}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatMetricsMoney(summary.avgOrderValueKgs)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">{t("metricsMargin")}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatSalesOrderMargin(profitability?.marginPct ?? null, locale)}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {summary && profitability && !profitability.costsComplete ? (
        <p
          role="status"
          className="mt-3 rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm text-foreground/80"
        >
          {t("metricsCostIncomplete", { count: summary.missingCostLines })}
        </p>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("metricsTrendTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {seriesRows.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("date")}</TableHead>
                      <TableHead>{t("metricsRevenue")}</TableHead>
                      <TableHead>{t("metricsCost")}</TableHead>
                      <TableHead>{t("metricsProfit")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {seriesRows.map((row) => (
                      <TableRow key={row.date}>
                        <TableCell>{formatDate(row.date, locale)}</TableCell>
                        <TableCell>{formatMetricsMoney(row.revenueKgs)}</TableCell>
                        <TableCell>
                          {row.costKgs === null ? "—" : formatMetricsMoney(row.costKgs)}
                        </TableCell>
                        <TableCell>
                          {row.profitKgs === null ? "—" : formatMetricsMoney(row.profitKgs)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("metricsNoData")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("metricsTopProducts")}</CardTitle>
          </CardHeader>
          <CardContent>
            {topProducts.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("product")}</TableHead>
                      <TableHead>{t("qty")}</TableHead>
                      <TableHead>{t("metricsRevenue")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topProducts.map((item) => (
                      <TableRow key={item.productId}>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{item.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{item.sku}</p>
                          </div>
                        </TableCell>
                        <TableCell>{item.qty}</TableCell>
                        <TableCell>{formatMetricsMoney(item.revenueKgs)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("metricsNoData")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{t("metricsTopBundles")}</CardTitle>
        </CardHeader>
        <CardContent>
          {topBundles.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("product")}</TableHead>
                    <TableHead>{t("qty")}</TableHead>
                    <TableHead>{t("metricsRevenue")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topBundles.map((item) => (
                    <TableRow key={item.productId}>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{item.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{item.sku}</p>
                        </div>
                      </TableCell>
                      <TableCell>{item.qty}</TableCell>
                      <TableCell>{formatMetricsMoney(item.revenueKgs)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {t("metricsNoBundles")}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SalesOrdersMetricsPage;
