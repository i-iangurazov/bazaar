"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader } from "@/components/page-header";
import { QueryErrorState } from "@/components/query-error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AddIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  EmptyIcon,
  PosIcon,
  ReceiveIcon,
  TransferIcon,
  ProductMovementIcon,
  ReportsIcon,
} from "@/components/icons";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/i18nFormat";
import {
  convertFromKgs,
  normalizeCurrencyCode,
  normalizeCurrencyRateKgsPerUnit,
} from "@/lib/currency";
import { getPurchaseOrderStatusLabel } from "@/lib/i18n/status";
import { hasPermission, type RoleAccess } from "@/lib/roleAccess";
import { addBusinessDays, businessDateKey, businessDateOnlyToUtc } from "@/lib/timezone";
import { trpc } from "@/lib/trpc";
import { useSse } from "@/lib/useSse";
import { cn } from "@/lib/utils";

const QuietState = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-24 items-center gap-3 text-sm leading-6 text-muted-foreground">
    <EmptyIcon className="h-5 w-5 shrink-0" aria-hidden />
    <span>{children}</span>
  </div>
);

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  const tAudit = useTranslations("audit");
  const tOrders = useTranslations("purchaseOrders");
  const tWorkspace = useTranslations("workspace");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const access: RoleAccess = useMemo(
    () => ({
      role: session?.user?.role,
      isOrgOwner: Boolean(session?.user?.isOrgOwner),
      isPlatformOwner: Boolean(session?.user?.isPlatformOwner),
    }),
    [session?.user],
  );
  const requestedStoreId = searchParams.get("storeId") || undefined;
  const dashboardQuery = trpc.dashboard.bootstrap.useQuery({
    storeId: requestedStoreId,
    includeRecentActivity: false,
    includeRecentMovements: false,
  });
  // The server's resolved scope is authoritative, including a revoked or removed store.
  const storeId = dashboardQuery.data?.selectedStoreId ?? null;
  const selectedStore = dashboardQuery.data?.stores.find((store) => store.id === storeId);
  const activityQuery = trpc.dashboard.activity.useQuery(
    { storeId: storeId ?? "" },
    { enabled: Boolean(storeId) },
  );
  useSse({
    "inventory.updated": () => {
      void dashboardQuery.refetch();
      void activityQuery.refetch();
    },
    "purchaseOrder.updated": () => {
      void dashboardQuery.refetch();
      void activityQuery.refetch();
    },
    "lowStock.triggered": () => {
      void dashboardQuery.refetch();
      void activityQuery.refetch();
    },
  });
  const business = dashboardQuery.data?.summary.business;
  const comparison = dashboardQuery.data?.summary.comparison;
  const salesSeries = dashboardQuery.data?.summary.salesSeries ?? [];
  const topProducts = dashboardQuery.data?.summary.topProducts ?? [];
  const lowStock = dashboardQuery.data?.summary.lowStock ?? [];
  const pendingOrders = dashboardQuery.data?.summary.pendingPurchaseOrders ?? [];
  const activity = activityQuery.data?.recentActivity ?? [];
  const today = salesSeries.at(-1)?.date ?? businessDateKey(new Date());
  const weekStart = salesSeries[0]?.date ?? addBusinessDays(today, -6);
  const currencyCode = normalizeCurrencyCode(selectedStore?.currencyCode);
  const currencyRate = normalizeCurrencyRateKgsPerUnit(
    selectedStore?.currencyRateKgsPerUnit,
    currencyCode,
  );
  const money = (value: number) =>
    formatCurrency(convertFromKgs(value, currencyRate, currencyCode), locale, currencyCode);
  const number = (value: number) => formatNumber(value, locale);
  const scopedHref = (path: string, params: Record<string, string> = {}) => {
    const url = new URL(path, "https://local.invalid");
    if (storeId) url.searchParams.set(path.startsWith("/pos") ? "store" : "storeId", storeId);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.pathname + "?" + url.searchParams.toString();
  };
  const reportHref = (from = today, to = today) =>
    scopedHref("/reports/analytics", { dateFrom: from, dateTo: to });
  const renderTrendBadge = (delta: number | null | undefined) => {
    if (delta === null || delta === undefined) return null;
    const Icon = delta < 0 ? ArrowDownIcon : ArrowUpIcon;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-xs",
          delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-muted-foreground",
        )}
      >
        {Math.abs(delta) < 0.05 ? (
          t("unchanged")
        ) : (
          <>
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {formatNumber(Math.abs(delta), locale, { maximumFractionDigits: 1 })}%
          </>
        )}
        <span className="text-muted-foreground">{t("vsYesterday")}</span>
      </span>
    );
  };
  const header = (
    <PageHeader
      title={tWorkspace("dailyOverview")}
      subtitle={tWorkspace("dailyHint")}
      action={
        <Button asChild variant="secondary">
          <Link href={reportHref(weekStart, today)}>
            <ReportsIcon className="h-4 w-4" aria-hidden />
            {t("viewReports")}
          </Link>
        </Button>
      }
    />
  );
  if (dashboardQuery.isError && !dashboardQuery.data) {
    return (
      <div>
        {header}
        <QueryErrorState onRetry={() => void dashboardQuery.refetch()} />
      </div>
    );
  }
  if (!dashboardQuery.data)
    return (
      <div aria-busy="true">
        {header}
        <Skeleton className="mb-5 h-14 w-full" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-36 rounded-xl" />
          ))}
        </div>
        <Skeleton className="mt-5 h-72 w-full rounded-xl" />
        <p role="status" className="sr-only">
          {tCommon("loading")}
        </p>
      </div>
    );
  if (!storeId || !selectedStore)
    return (
      <div>
        {header}
        <Card>
          <CardContent>
            <QuietState>{tWorkspace("noStore")}</QuietState>
            {hasPermission(access, "manageSettings") ? (
              <Button asChild>
                <Link href="/stores/new">{tWorkspace("noStore")}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );

  const attentionItems = [
    {
      key: "lowStock",
      label: t("lowStock"),
      value: business!.lowStockCount,
      href: scopedHref("/inventory", { stockFilter: "lowStock" }),
      variant: "warning" as const,
    },
    {
      key: "negativeStock",
      label: t("negativeStock"),
      value: business!.negativeStockCount,
      href: scopedHref("/inventory", { stockFilter: "negativeStock" }),
      variant: "danger" as const,
    },
    {
      key: "missingPrice",
      label: t("missingPrice"),
      value: business!.missingPriceCount,
      href: scopedHref("/products", { readiness: "missingPrice" }),
      variant: "warning" as const,
    },
    {
      key: "missingBarcode",
      label: t("missingBarcode"),
      value: business!.missingBarcodeCount,
      href: scopedHref("/products", { readiness: "missingBarcode" }),
      variant: "muted" as const,
    },
  ].filter((item) => item.value > 0);
  const kpis = [
    {
      key: "sales",
      label: t("todaySales"),
      value: money(business!.todaySalesKgs),
      hint: t("todaySalesHint"),
      trend: comparison?.salesDeltaPercent,
    },
    {
      key: "receipts",
      label: tWorkspace("todayOrders"),
      value: number(business!.receiptsCount),
      hint: tWorkspace("todayOrdersHint"),
      trend: comparison?.receiptsDeltaPercent,
    },
    {
      key: "average",
      label: t("averageReceipt"),
      value: business!.receiptsCount ? money(business!.averageReceiptKgs) : tCommon("notAvailable"),
      hint: t("averageReceiptHint"),
      trend: comparison?.averageReceiptDeltaPercent,
    },
    {
      key: "profit",
      label: t("grossProfit"),
      value:
        business!.grossProfitKgs === null ? t("notCalculated") : money(business!.grossProfitKgs),
      hint: !business!.receiptsCount
        ? tWorkspace("noProfitYet")
        : business!.grossMarginPercent === null
          ? t("grossProfitMissingCostHint")
          : t("grossMargin", {
              value: formatNumber(business!.grossMarginPercent, locale, {
                maximumFractionDigits: 1,
              }),
            }),
      trend: undefined,
    },
  ];
  const actions = [
    {
      key: "sale",
      label: t("startSale"),
      href: scopedHref("/pos"),
      icon: PosIcon,
      allowed: hasPermission(access, "usePos"),
    },
    {
      key: "receive",
      label: t("receiveStock"),
      href: scopedHref("/inventory/receiving"),
      icon: ReceiveIcon,
      allowed: hasPermission(access, "viewInventory"),
    },
    {
      key: "product",
      label: t("addProduct"),
      href: scopedHref("/products/new"),
      icon: AddIcon,
      allowed: hasPermission(access, "manageProducts"),
    },
    {
      key: "transfer",
      label: t("transferStock"),
      href: scopedHref("/inventory/transfers", { fromStoreId: storeId }),
      icon: TransferIcon,
      allowed: hasPermission(access, "viewInventory"),
    },
    {
      key: "movements",
      label: t("productMovement"),
      href: scopedHref("/inventory/movements"),
      icon: ProductMovementIcon,
      allowed: hasPermission(access, "viewInventory"),
    },
  ].filter((action) => action.allowed);
  const weekTotal = salesSeries.reduce((sum, day) => sum + day.salesKgs, 0);
  const maxSales = Math.max(...salesSeries.map((day) => day.salesKgs), 0);
  const hasSales = salesSeries.some((day) => day.receiptsCount > 0);
  return (
    <div data-dashboard>
      {header}
      <div className="mb-5 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
          <label htmlFor="dashboard-store" className="text-sm text-muted-foreground">
            {tCommon("store")}
          </label>
          <div className="min-w-0 flex-1 sm:max-w-72">
            <Select
              value={storeId}
              onValueChange={(id) =>
                router.replace(`/dashboard?storeId=${encodeURIComponent(id)}`, { scroll: false })
              }
            >
              <SelectTrigger id="dashboard-store" data-tour="dashboard-store-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dashboardQuery.data.stores.map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {tWorkspace("todayContext", { date: formatDate(businessDateOnlyToUtc(today), locale) })}
        </p>
      </div>
      {dashboardQuery.isError ? (
        <QueryErrorState className="mb-4" onRetry={() => void dashboardQuery.refetch()} />
      ) : null}
      <section
        aria-label={t("businessOverview")}
        className="workspace-kpi-grid grid grid-cols-2 gap-3"
      >
        {kpis.map((kpi, index) => (
          <Link
            key={kpi.key}
            href={reportHref()}
            data-dashboard-kpi={kpi.key}
            className={cn(
              "group min-w-0 rounded-xl border border-border bg-card p-4 text-foreground transition-colors hover:border-primary/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:p-5",
              index === 0 && "border-primary/30",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="min-w-0 break-words text-sm font-medium text-muted-foreground">
                {kpi.label}
              </h2>
              <ChevronRightIcon
                className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary"
                aria-hidden
              />
            </div>
            <p className="mt-3 break-words text-xl font-semibold tabular-nums leading-tight tracking-tight [font-size:clamp(1.125rem,3cqi,1.75rem)]">
              {kpi.value}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{kpi.hint}</p>
            {kpi.trend !== null && kpi.trend !== undefined ? (
              <div className="mt-2">{renderTrendBadge(kpi.trend)}</div>
            ) : null}
          </Link>
        ))}
      </section>
      <section aria-label={t("quickActions")} className="my-5 flex flex-wrap gap-2">
        {actions.map((action, index) => (
          <Button
            key={action.key}
            asChild
            variant={index === 0 ? "primary" : "secondary"}
            className="h-auto min-h-10 py-2"
          >
            <Link href={action.href}>
              <action.icon className="h-4 w-4" aria-hidden />
              {action.label}
            </Link>
          </Button>
        ))}
      </section>
      <div className="workspace-dashboard-grid grid gap-5">
        <Card className="workspace-dashboard-chart">
          <CardHeader className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{t("salesLast7Days")}</CardTitle>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {formatDate(businessDateOnlyToUtc(weekStart), locale)} —{" "}
                {formatDate(businessDateOnlyToUtc(today), locale)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xl font-semibold tabular-nums">{money(weekTotal)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{tWorkspace("last7DaysTotal")}</p>
            </div>
          </CardHeader>
          <CardContent>
            {hasSales ? (
              <figure aria-label={t("salesSeriesHint")}>
                <div className="flex h-56 items-end gap-2 border-b border-border sm:gap-4">
                  {salesSeries.map((day) => (
                    <div
                      key={day.date}
                      className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2 self-stretch"
                    >
                      <span
                        className="max-w-full truncate text-[10px] tabular-nums text-muted-foreground sm:text-xs"
                        title={money(day.salesKgs)}
                      >
                        {formatNumber(
                          convertFromKgs(day.salesKgs, currencyRate, currencyCode),
                          locale,
                          { maximumFractionDigits: 0 },
                        )}
                      </span>
                      <div
                        className="w-full max-w-14 rounded-t-md bg-primary"
                        style={{ height: maxSales > 0 ? `${(day.salesKgs / maxSales) * 75}%` : 0 }}
                        title={tWorkspace("dailySalesPoint", {
                          date: formatDate(day.date, locale),
                          amount: money(day.salesKgs),
                        })}
                      />
                      <span className="pb-2 text-[10px] tabular-nums text-muted-foreground sm:text-xs">
                        {day.date.slice(8)}.{day.date.slice(5, 7)}
                      </span>
                    </div>
                  ))}
                </div>
                <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{t("salesSeriesHint")}</span>
                  <Link
                    className="inline-flex min-h-8 items-center gap-1 font-medium"
                    href={reportHref(weekStart, today)}
                  >
                    {tWorkspace("viewDetails")}
                    <ChevronRightIcon className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </figcaption>
              </figure>
            ) : (
              <QuietState>{t("noSalesForPeriod")}</QuietState>
            )}
          </CardContent>
        </Card>
        <Card className="workspace-dashboard-attention">
          <CardHeader>
            <CardTitle>{t("needsAttention")}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{selectedStore.name}</p>
          </CardHeader>
          <CardContent className="space-y-1">
            {attentionItems.length ? (
              attentionItems.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className="flex min-h-12 items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm text-foreground hover:bg-muted"
                >
                  <span>{item.label}</span>
                  <span className="flex items-center gap-1">
                    <Badge variant={item.variant}>{number(item.value)}</Badge>
                    <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  </span>
                </Link>
              ))
            ) : (
              <QuietState>{t("noAttentionTasks")}</QuietState>
            )}
            <div className="mt-2 border-t border-border pt-2">
              <Link
                href={scopedHref("/pos/registers")}
                className="flex min-h-11 items-center justify-between gap-2 text-sm text-foreground"
              >
                <span>{t("openShifts")}</span>
                <Badge variant="muted">{number(business!.openShiftsCount)}</Badge>
              </Link>
              {business!.failedReceiptsCount > 0 ? (
                <Link
                  href={scopedHref("/pos/kkm", { status: "FAILED" })}
                  className="flex min-h-11 items-center justify-between gap-2 text-sm text-foreground"
                >
                  <span>{t("failedReceipts")}</span>
                  <Badge variant="danger">{number(business!.failedReceiptsCount)}</Badge>
                </Link>
              ) : null}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>{t("topProducts")}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">{t("last7Days")}</p>
            </div>
            <Link href={reportHref(weekStart, today)} className="text-xs font-medium">
              {tWorkspace("viewDetails")}
            </Link>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {topProducts.length ? (
              topProducts.map((product, index) => (
                <Link
                  key={product.productId}
                  href={scopedHref(`/products/${product.productId}`, {
                    returnTo: scopedHref("/dashboard"),
                  })}
                  className="flex items-center gap-3 py-3 text-foreground"
                >
                  <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium">{product.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{product.sku}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium tabular-nums">{money(product.revenueKgs)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {number(product.quantity)} {t("quantitySold")}
                    </p>
                  </div>
                </Link>
              ))
            ) : (
              <QuietState>{t("noTopProducts")}</QuietState>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{t("lowStockProducts")}</CardTitle>
            <Link
              href={scopedHref("/inventory", { stockFilter: "lowStock" })}
              className="text-xs font-medium"
            >
              {tWorkspace("viewAll")}
            </Link>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {lowStock.length ? (
              lowStock.slice(0, 5).map((item) => (
                <Link
                  key={item.snapshot.id}
                  href={scopedHref("/inventory", { q: item.product.sku || item.product.name })}
                  className="flex min-h-16 items-center justify-between gap-3 py-3 text-foreground"
                >
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm font-medium">{item.product.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.product.sku}
                      {item.variant?.name ? ` · ${item.variant.name}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums">
                      {number(item.snapshot.onHand)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("currentVsMinimum", { min: number(item.minStock) })}
                    </p>
                  </div>
                </Link>
              ))
            ) : (
              <QuietState>{t("noLowStockProducts")}</QuietState>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{t("pendingPurchaseOrders")}</CardTitle>
            <Link href={scopedHref("/purchase-orders")} className="text-xs font-medium">
              {tWorkspace("viewDetails")}
            </Link>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {pendingOrders.length ? (
              pendingOrders.map((po) => (
                <Link
                  key={po.id}
                  href={scopedHref(`/purchase-orders/${po.id}`, {
                    returnTo: scopedHref("/dashboard"),
                  })}
                  className="flex min-h-16 flex-wrap items-center justify-between gap-2 py-3 text-foreground"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {po.supplier?.name ?? tCommon("supplierUnassigned")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDateTime(po.createdAt, locale)}
                    </p>
                  </div>
                  <Badge variant="warning">{getPurchaseOrderStatusLabel(tOrders, po.status)}</Badge>
                </Link>
              ))
            ) : (
              <QuietState>{t("noPending")}</QuietState>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("recentActivity")}</CardTitle>
          </CardHeader>
          <CardContent>
            {activityQuery.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((key) => (
                  <Skeleton key={key} className="h-10" />
                ))}
              </div>
            ) : activityQuery.isError ? (
              <QueryErrorState onRetry={() => void activityQuery.refetch()} />
            ) : activity.length ? (
              <ol className="divide-y divide-border">
                {activity.slice(0, 6).map((item) => (
                  <li key={item.id} className="py-3">
                    <p className="text-sm leading-5">
                      {item.summaryKey
                        ? tAudit(item.summaryKey, item.summaryValues ?? {})
                        : tAudit.has(`actions.${item.action}`)
                          ? tAudit(`actions.${item.action}`)
                          : tWorkspace.has(`activityActions.${item.action}`)
                            ? tWorkspace(`activityActions.${item.action}`)
                            : tAudit("fallback")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.actor?.name ?? tAudit("systemActor")} ·{" "}
                      {formatDateTime(item.createdAt, locale)}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <QuietState>{t("noActivity")}</QuietState>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
