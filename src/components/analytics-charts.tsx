"use client";

import { useTranslations } from "next-intl";
import type { TRPCClientErrorLike } from "@trpc/client";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyIcon, MetricsIcon, PriceIcon, ProductsIcon, StatusWarningIcon } from "@/components/icons";
import { formatCurrencyKGS, formatDate, formatNumber } from "@/lib/i18nFormat";
import { translateError } from "@/lib/translateError";
import type { AppRouter } from "@/server/trpc/routers/_app";

type Metric = "units" | "revenue" | "profit";

type AnalyticsChartsProps = {
  salesSeries: { date: string; value: number }[];
  salesFallback: boolean;
  salesLoading: boolean;
  salesError?: TRPCClientErrorLike<AppRouter> | null;
  topProducts: { sku: string; name: string; value: number }[];
  topLoading: boolean;
  topError?: TRPCClientErrorLike<AppRouter> | null;
  canProfit: boolean;
  metric: Metric;
  onMetricChange: (value: Metric) => void;
  lowStockChart: { date: string; lowStock: number; stockout: number }[];
  lowStockLoading: boolean;
  lowStockError?: TRPCClientErrorLike<AppRouter> | null;
  showStockouts: boolean;
  inventoryValue?: {
    valueKgs: number;
    deadStock30: number;
    deadStock60: number;
    deadStock90: number;
  } | null;
  inventoryLoading: boolean;
  inventoryError?: TRPCClientErrorLike<AppRouter> | null;
  locale: string;
};

const chartColors = {
  grid: "hsl(var(--border))",
  axis: "hsl(var(--muted-foreground))",
  primary: "hsl(var(--primary))",
  warning: "hsl(var(--warning))",
  warningSoft: "hsl(var(--warning) / 0.22)",
  danger: "hsl(var(--danger))",
  tooltipBackground: "hsl(var(--popover))",
  tooltipBorder: "hsl(var(--border))",
  tooltipText: "hsl(var(--popover-foreground))",
};

export const AnalyticsCharts = ({
  salesSeries,
  salesFallback,
  salesLoading,
  salesError,
  topProducts,
  topLoading,
  topError,
  canProfit,
  metric,
  onMetricChange,
  lowStockChart,
  lowStockLoading,
  lowStockError,
  showStockouts,
  inventoryValue,
  inventoryLoading,
  inventoryError,
  locale,
}: AnalyticsChartsProps) => {
  const t = useTranslations("analytics");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  const formatMetricValue = (value: number) => {
    if (metric === "revenue" || metric === "profit") {
      return formatCurrencyKGS(value, locale);
    }
    return formatNumber(value, locale);
  };

  const tooltipStyle = {
    backgroundColor: chartColors.tooltipBackground,
    border: `1px solid ${chartColors.tooltipBorder}`,
    borderRadius: "0.5rem",
    color: chartColors.tooltipText,
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MetricsIcon className="h-4 w-4 text-primary" aria-hidden />
            {t("salesTrend")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {salesLoading ? (
            <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>
          ) : salesError ? (
            <p className="text-sm text-danger">{translateError(tErrors, salesError)}</p>
          ) : salesSeries.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={salesSeries}>
                  <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string | number) => formatDate(value, locale)}
                    axisLine={{ stroke: chartColors.grid }}
                    tick={{ fill: chartColors.axis, fontSize: 12 }}
                    tickLine={{ stroke: chartColors.grid }}
                  />
                  <YAxis
                    tickFormatter={(value: string | number) => formatNumber(Number(value), locale)}
                    axisLine={{ stroke: chartColors.grid }}
                    tick={{ fill: chartColors.axis, fontSize: 12 }}
                    tickLine={{ stroke: chartColors.grid }}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(value: string | number) => formatDate(value, locale)}
                    formatter={(value: string | number) => formatNumber(Number(value), locale)}
                    itemStyle={{ color: chartColors.tooltipText }}
                    labelStyle={{ color: chartColors.tooltipText }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={chartColors.primary}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
              {salesFallback ? (
                <p className="mt-2 text-xs text-muted-foreground">{t("salesFallback")}</p>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {t("emptySales")}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            <ProductsIcon className="h-4 w-4 text-primary" aria-hidden />
            {t("topProducts")}
          </CardTitle>
          <div className="w-full sm:max-w-[180px]">
            <Select value={metric} onValueChange={(value) => onMetricChange(value as Metric)}>
              <SelectTrigger>
                <SelectValue placeholder={t("metricLabel")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="units">{t("metricUnits")}</SelectItem>
                <SelectItem value="revenue">{t("metricRevenue")}</SelectItem>
                {canProfit ? <SelectItem value="profit">{t("metricProfit")}</SelectItem> : null}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {topLoading ? (
            <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>
          ) : topError ? (
            <p className="text-sm text-danger">{translateError(tErrors, topError)}</p>
          ) : topProducts.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProducts} margin={{ left: 8 }}>
                  <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="sku"
                    axisLine={{ stroke: chartColors.grid }}
                    tick={{ fill: chartColors.axis, fontSize: 12 }}
                    tickLine={{ stroke: chartColors.grid }}
                  />
                  <YAxis
                    tickFormatter={(value: string | number) => formatNumber(Number(value), locale)}
                    axisLine={{ stroke: chartColors.grid }}
                    tick={{ fill: chartColors.axis, fontSize: 12 }}
                    tickLine={{ stroke: chartColors.grid }}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: string | number) => formatMetricValue(Number(value))}
                    labelFormatter={(label: string | number) => String(label)}
                    itemStyle={{ color: chartColors.tooltipText }}
                    labelStyle={{ color: chartColors.tooltipText }}
                  />
                  <Bar dataKey="value" fill={chartColors.primary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {t("emptyTopProducts")}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StatusWarningIcon className="h-4 w-4 text-warning" aria-hidden />
            {t("lowStockTrend")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lowStockLoading ? (
            <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>
          ) : lowStockError ? (
            <p className="text-sm text-danger">{translateError(tErrors, lowStockError)}</p>
          ) : lowStockChart.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={lowStockChart}>
                  <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string | number) => formatDate(value, locale)}
                    axisLine={{ stroke: chartColors.grid }}
                    tick={{ fill: chartColors.axis, fontSize: 12 }}
                    tickLine={{ stroke: chartColors.grid }}
                  />
                  <YAxis
                    tickFormatter={(value: string | number) => formatNumber(Number(value), locale)}
                    axisLine={{ stroke: chartColors.grid }}
                    tick={{ fill: chartColors.axis, fontSize: 12 }}
                    tickLine={{ stroke: chartColors.grid }}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(value: string | number) => formatDate(value, locale)}
                    formatter={(value: string | number, name: string) =>
                      name === "stockout"
                        ? [formatNumber(Number(value), locale), t("stockoutTrend")]
                        : [formatNumber(Number(value), locale), t("lowStockTrend")]
                    }
                    itemStyle={{ color: chartColors.tooltipText }}
                    labelStyle={{ color: chartColors.tooltipText }}
                  />
                  <Area
                    type="monotone"
                    dataKey="lowStock"
                    stroke={chartColors.warning}
                    fill={chartColors.warningSoft}
                  />
                  {showStockouts ? (
                    <Line
                      type="monotone"
                      dataKey="stockout"
                      stroke={chartColors.danger}
                      strokeWidth={2}
                      dot={false}
                    />
                  ) : null}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {t("emptyLowStock")}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PriceIcon className="h-4 w-4 text-primary" aria-hidden />
            {t("inventoryValue")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {inventoryLoading ? (
            <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>
          ) : inventoryError ? (
            <p className="text-sm text-danger">{translateError(tErrors, inventoryError)}</p>
          ) : inventoryValue ? (
            <div className="space-y-4">
              <div className="text-2xl font-semibold text-foreground">
                {formatCurrencyKGS(inventoryValue.valueKgs, locale)}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">{t("deadStock30")}</p>
                  <p className="text-lg font-semibold text-foreground">
                    {formatNumber(inventoryValue.deadStock30, locale)}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">{t("deadStock60")}</p>
                  <p className="text-lg font-semibold text-foreground">
                    {formatNumber(inventoryValue.deadStock60, locale)}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">{t("deadStock90")}</p>
                  <p className="text-lg font-semibold text-foreground">
                    {formatNumber(inventoryValue.deadStock90, locale)}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {t("emptyInventory")}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AnalyticsCharts;
