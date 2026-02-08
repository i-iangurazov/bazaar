"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import dynamic from "next/dynamic";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { PageSkeleton } from "@/components/page-skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";

type Metric = "units" | "revenue" | "profit";

const AnalyticsCharts = dynamic(
  () => import("@/components/analytics-charts").then((mod) => mod.AnalyticsCharts),
  { ssr: false, loading: () => <PageSkeleton blocks={4} /> },
);

const AnalyticsPage = () => {
  const t = useTranslations("analytics");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const role = session?.user?.role ?? "STAFF";
  const canViewOrg = role !== "STAFF";

  const [storeId, setStoreId] = useState("");
  const [rangeDays, setRangeDays] = useState(30);
  const [granularity, setGranularity] = useState<"day" | "week">("day");
  const [metric, setMetric] = useState<Metric>("units");

  const storesQuery = trpc.stores.list.useQuery(undefined, {
    enabled: status === "authenticated",
  });

  useEffect(() => {
    if (storeId || !storesQuery.data?.length) {
      return;
    }
    setStoreId(canViewOrg ? "all" : storesQuery.data[0].id);
  }, [storeId, storesQuery.data, canViewOrg]);

  const resolvedStoreId = storeId === "all" ? undefined : storeId || undefined;
  const analyticsEnabled =
    status === "authenticated" && (canViewOrg || Boolean(resolvedStoreId));

  const salesTrendQuery = trpc.analytics.salesTrend.useQuery(
    { storeId: resolvedStoreId, rangeDays, granularity },
    { enabled: analyticsEnabled },
  );
  const topProductsQuery = trpc.analytics.topProducts.useQuery(
    { storeId: resolvedStoreId, rangeDays, metric },
    { enabled: analyticsEnabled },
  );
  const stockQuery = trpc.analytics.stockoutsLowStock.useQuery(
    { storeId: resolvedStoreId, rangeDays },
    { enabled: analyticsEnabled },
  );
  const inventoryValueQuery = trpc.analytics.inventoryValue.useQuery(
    { storeId: resolvedStoreId },
    { enabled: analyticsEnabled },
  );

  useEffect(() => {
    if (metric === "profit" && topProductsQuery.data && !topProductsQuery.data.canProfit) {
      setMetric("units");
    }
  }, [metric, topProductsQuery.data]);

  const salesSeries = useMemo(
    () =>
      (salesTrendQuery.data?.series ?? []).map((point) => ({
        date: point.date,
        value: point.salesKgs,
      })),
    [salesTrendQuery.data],
  );

  const topProducts = topProductsQuery.data?.items ?? [];
  const lowStockSeries = useMemo(
    () => stockQuery.data?.lowStockCountSeries ?? [],
    [stockQuery.data],
  );
  const stockoutSeries = useMemo(
    () => stockQuery.data?.stockoutEventsCount ?? [],
    [stockQuery.data],
  );

  const lowStockChart = useMemo(() => {
    const map = new Map<string, { date: string; lowStock: number; stockout: number }>();
    lowStockSeries.forEach((point) => {
      map.set(point.date, { date: point.date, lowStock: point.value, stockout: 0 });
    });
    stockoutSeries.forEach((point) => {
      const existing = map.get(point.date);
      if (existing) {
        existing.stockout = point.value;
      } else {
        map.set(point.date, { date: point.date, lowStock: 0, stockout: point.value });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [lowStockSeries, stockoutSeries]);

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <Button asChild variant="secondary">
            <Link href="/reports">{t("backToReports")}</Link>
          </Button>
        }
        filters={
          <>
            <div className="w-full sm:max-w-xs">
              <Select
                value={storeId || (canViewOrg ? "all" : "")}
                onValueChange={setStoreId}
              >
                <SelectTrigger>
                  <SelectValue placeholder={tCommon("selectStore")} />
                </SelectTrigger>
                <SelectContent>
                  {canViewOrg ? <SelectItem value="all">{t("allStores")}</SelectItem> : null}
                  {storesQuery.data?.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:max-w-xs">
              <Select value={String(rangeDays)} onValueChange={(value) => setRangeDays(Number(value))}>
                <SelectTrigger>
                  <SelectValue placeholder={t("rangeLabel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">{t("range30")}</SelectItem>
                  <SelectItem value="90">{t("range90")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:max-w-xs">
              <Select value={granularity} onValueChange={(value) => setGranularity(value as "day" | "week")}>
                <SelectTrigger>
                  <SelectValue placeholder={t("granularityLabel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">{t("granularityDay")}</SelectItem>
                  <SelectItem value="week">{t("granularityWeek")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        }
      />

      <AnalyticsCharts
        salesSeries={salesSeries}
        salesFallback={salesTrendQuery.data?.usesFallback ?? false}
        salesLoading={salesTrendQuery.isLoading}
        salesError={salesTrendQuery.error}
        topProducts={topProducts}
        topLoading={topProductsQuery.isLoading}
        topError={topProductsQuery.error}
        canProfit={topProductsQuery.data?.canProfit ?? false}
        metric={metric}
        onMetricChange={setMetric}
        lowStockChart={lowStockChart}
        lowStockLoading={stockQuery.isLoading}
        lowStockError={stockQuery.error}
        showStockouts={stockoutSeries.length > 0}
        inventoryValue={inventoryValueQuery.data ?? null}
        inventoryLoading={inventoryValueQuery.isLoading}
        inventoryError={inventoryValueQuery.error}
        locale={locale}
      />
    </div>
  );
};

export default AnalyticsPage;
