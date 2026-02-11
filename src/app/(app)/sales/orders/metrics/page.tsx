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
import { formatCurrencyKGS } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const toDateValue = (date: Date) => date.toISOString().slice(0, 10);

const SalesOrdersMetricsPage = () => {
  const t = useTranslations("salesOrders");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session } = useSession();

  const canView = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";

  const now = useMemo(() => new Date(), []);
  const initialFrom = useMemo(() => {
    const value = new Date(now);
    value.setDate(value.getDate() - 30);
    return toDateValue(value);
  }, [now]);
  const initialTo = useMemo(() => toDateValue(now), [now]);

  const [storeId, setStoreId] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>(initialFrom);
  const [dateTo, setDateTo] = useState<string>(initialTo);
  const [groupBy, setGroupBy] = useState<"day" | "week">("day");

  const storesQuery = trpc.stores.list.useQuery(undefined, { enabled: canView });
  const metricsQuery = trpc.salesOrders.metrics.useQuery(
    {
      storeId: storeId === "all" ? undefined : storeId,
      dateFrom: new Date(`${dateFrom}T00:00:00.000Z`),
      dateTo: new Date(`${dateTo}T23:59:59.999Z`),
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
  const revenueSeries = metricsQuery.data?.revenueSeries ?? [];
  const profitSeries = metricsQuery.data?.profitSeries ?? [];
  const costSeries = metricsQuery.data?.costSeries ?? [];
  const topProducts = metricsQuery.data?.topProductsByRevenue ?? [];
  const topBundles = metricsQuery.data?.topBundlesByRevenue ?? [];

  const seriesRows = revenueSeries.map((revenueItem, index) => ({
    date: revenueItem.date,
    revenueKgs: revenueItem.revenueKgs,
    costKgs: costSeries[index]?.costKgs ?? 0,
    profitKgs: profitSeries[index]?.profitKgs ?? 0,
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
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
                {formatCurrencyKGS(summary.totalRevenueKgs, locale)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">{t("metricsCost")}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatCurrencyKGS(summary.totalCostKgs, locale)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">{t("metricsProfit")}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatCurrencyKGS(summary.totalProfitKgs, locale)}
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
                {formatCurrencyKGS(summary.avgOrderValueKgs, locale)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">{t("metricsMargin")}</p>
              <p className="text-lg font-semibold text-foreground">{summary.marginPct.toFixed(2)}%</p>
            </CardContent>
          </Card>
        </div>
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
                        <TableCell>{row.date}</TableCell>
                        <TableCell>{formatCurrencyKGS(row.revenueKgs, locale)}</TableCell>
                        <TableCell>{formatCurrencyKGS(row.costKgs, locale)}</TableCell>
                        <TableCell>{formatCurrencyKGS(row.profitKgs, locale)}</TableCell>
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
                        <TableCell>{formatCurrencyKGS(item.revenueKgs, locale)}</TableCell>
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
                      <TableCell>{formatCurrencyKGS(item.revenueKgs, locale)}</TableCell>
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
