"use client";

import { useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { MobileQuickActionButton, MobileTaskCard } from "@/components/mobile-app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EmptyIcon,
  AddIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  PrintIcon,
  ReceiveIcon,
  PosIcon,
  CustomerDatabaseIcon,
  ProductMovementIcon,
  TransferIcon,
  InventoryIcon,
  UploadIcon,
} from "@/components/icons";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/i18nFormat";
import {
  convertFromKgs,
  normalizeCurrencyCode,
  normalizeCurrencyRateKgsPerUnit,
} from "@/lib/currency";
import { toIntlLocale } from "@/lib/locales";
import { getPurchaseOrderStatusLabel } from "@/lib/i18n/status";
import { hasPermission, type AppPermission, type RoleAccess } from "@/lib/roleAccess";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useSse } from "@/lib/useSse";
import { cn } from "@/lib/utils";

const parseSeriesDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
};

const DashboardPage = () => {
  const t = useTranslations("dashboard");
  const tAudit = useTranslations("audit");
  const tOrders = useTranslations("purchaseOrders");
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");
  const tInventory = useTranslations("inventory");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session } = useSession();
  const access: RoleAccess = useMemo(
    () => ({
      role: session?.user?.role,
      isPlatformOwner: Boolean(session?.user?.isPlatformOwner),
      isOrgOwner: Boolean(session?.user?.isOrgOwner),
    }),
    [session?.user?.isOrgOwner, session?.user?.isPlatformOwner, session?.user?.role],
  );
  const [requestedStoreId, setRequestedStoreId] = useState<string | null>(null);
  const dashboardQuery = trpc.dashboard.bootstrap.useQuery(
    requestedStoreId
      ? {
          storeId: requestedStoreId,
          includeRecentActivity: false,
          includeRecentMovements: false,
        }
      : {
          includeRecentActivity: false,
          includeRecentMovements: false,
        },
  );
  const storeId = requestedStoreId ?? dashboardQuery.data?.selectedStoreId ?? null;
  const activityQuery = trpc.dashboard.activity.useQuery(
    { storeId: storeId ?? "" },
    { enabled: Boolean(storeId) },
  );

  useSse({
    "inventory.updated": () => {
      dashboardQuery.refetch();
      activityQuery.refetch();
    },
    "purchaseOrder.updated": () => {
      dashboardQuery.refetch();
      activityQuery.refetch();
    },
    "lowStock.triggered": () => {
      dashboardQuery.refetch();
      activityQuery.refetch();
    },
  });

  const selectedStore = useMemo(
    () => dashboardQuery.data?.stores.find((store) => store.id === storeId) ?? null,
    [dashboardQuery.data?.stores, storeId],
  );

  const pendingOrders = dashboardQuery.data?.summary.pendingPurchaseOrders ?? [];
  const business = dashboardQuery.data?.summary.business;
  const activity = activityQuery.data?.recentActivity ?? [];
  const currencyCode = normalizeCurrencyCode(selectedStore?.currencyCode);
  const currencyRate = normalizeCurrencyRateKgsPerUnit(
    selectedStore?.currencyRateKgsPerUnit,
    currencyCode,
  );
  const formatStoreMoney = (amountKgs: number) =>
    formatCurrency(convertFromKgs(amountKgs, currencyRate, currencyCode), locale, currencyCode);
  const formatCompactStoreMoney = (amountKgs: number) =>
    formatCurrency(convertFromKgs(amountKgs, currencyRate, currencyCode), locale, currencyCode, {
      maximumFractionDigits: 0,
      notation: "compact",
    });
  const formatPercent = (value: number) =>
    formatNumber(Math.abs(value), locale, {
      maximumFractionDigits: 1,
    });
  const formatSeriesDate = (value: string) =>
    new Intl.DateTimeFormat(toIntlLocale(locale), {
      day: "2-digit",
      month: "short",
    }).format(parseSeriesDate(value));

  const statusLabel = (status: string) => getPurchaseOrderStatusLabel(tOrders, status);

  const statusVariant = (status: string) => {
    switch (status) {
      case "CANCELLED":
        return "danger";
      case "APPROVED":
      case "SUBMITTED":
      case "DRAFT":
        return "warning";
      default:
        return "muted";
    }
  };

  const renderTrendBadge = (deltaPercent: number | null | undefined) => {
    if (deltaPercent === null || deltaPercent === undefined) {
      return <Badge variant="success">{t("newSinceYesterday")}</Badge>;
    }
    if (Math.abs(deltaPercent) < 0.05) {
      return <Badge variant="muted">{t("unchanged")}</Badge>;
    }
    const isPositive = deltaPercent > 0;
    const Icon = isPositive ? ArrowUpIcon : ArrowDownIcon;
    return (
      <Badge variant={isPositive ? "success" : "danger"} className="gap-1">
        <Icon className="h-3 w-3" aria-hidden />
        {isPositive ? "+" : "-"}
        {formatPercent(deltaPercent)}%
      </Badge>
    );
  };

  const loadingState = (
    <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner className="h-4 w-4" />
      {tCommon("loading")}
    </div>
  );

  const comparison = dashboardQuery.data?.summary.comparison;
  const salesSeries = dashboardQuery.data?.summary.salesSeries ?? [];
  const topProducts = dashboardQuery.data?.summary.topProducts ?? [];
  const lowStockProducts = dashboardQuery.data?.summary.lowStock ?? [];
  const seriesMaxSales = Math.max(...salesSeries.map((item) => item.salesKgs), 0);
  const hasSalesSeries = salesSeries.some((item) => item.salesKgs > 0 || item.receiptsCount > 0);
  const seriesTotalReceipts = salesSeries.reduce((sum, item) => sum + item.receiptsCount, 0);

  const kpis: Array<{
    key: string;
    label: string;
    value: string;
    hint: string;
    trend?: number | null;
    href?: string;
    valueClassName?: string;
  }> = [
    {
      key: "todaySales",
      label: t("todaySales"),
      value: formatStoreMoney(business?.todaySalesKgs ?? 0),
      hint: t("todaySalesHint"),
      trend: comparison?.salesDeltaPercent,
    },
    {
      key: "receiptsCount",
      label: t("receiptsCount"),
      value: formatNumber(business?.receiptsCount ?? 0, locale),
      hint: t("receiptsHint"),
      trend: comparison?.receiptsDeltaPercent,
    },
    {
      key: "averageReceipt",
      label: t("averageReceipt"),
      value: formatStoreMoney(business?.averageReceiptKgs ?? 0),
      hint: t("averageReceiptHint"),
      trend: comparison?.averageReceiptDeltaPercent,
    },
    {
      key: "grossProfit",
      label: t("grossProfit"),
      value:
        business?.grossProfitKgs === null || business?.grossProfitKgs === undefined
          ? t("notCalculated")
          : formatStoreMoney(business.grossProfitKgs),
      hint:
        business?.grossMarginPercent === null || business?.grossMarginPercent === undefined
          ? t("grossProfitMissingCostHint")
          : t("grossMargin", {
              value: formatNumber(business.grossMarginPercent, locale, {
                maximumFractionDigits: 1,
              }),
            }),
    },
    {
      key: "openShifts",
      label: t("openShifts"),
      value: formatNumber(business?.openShiftsCount ?? 0, locale),
      hint: t("openShiftsHint"),
      href: "/pos/registers",
    },
    {
      key: "lowStockCount",
      label: t("lowStock"),
      value: formatNumber(business?.lowStockCount ?? 0, locale),
      hint: t("lowStockHint"),
      href: "/inventory?stockFilter=lowStock",
      valueClassName: (business?.lowStockCount ?? 0) > 0 ? "text-warning" : "text-foreground",
    },
  ];
  const attentionItems = [
    {
      key: "missingBarcode",
      label: t("missingBarcode"),
      value: business?.missingBarcodeCount ?? 0,
      href: "/products?readiness=missingBarcode",
      variant: "warning" as const,
      permission: "viewProducts" as const,
    },
    {
      key: "missingPrice",
      label: t("missingPrice"),
      value: business?.missingPriceCount ?? 0,
      href: "/products?readiness=missingPrice",
      variant: "danger" as const,
      permission: "viewProducts" as const,
    },
    {
      key: "lowStock",
      label: t("lowStock"),
      value: business?.lowStockCount ?? 0,
      href: "/inventory?stockFilter=lowStock",
      variant: "warning" as const,
      permission: "viewInventory" as const,
    },
    {
      key: "negativeStock",
      label: t("negativeStock"),
      value: business?.negativeStockCount ?? 0,
      href: "/inventory",
      variant: "danger" as const,
      permission: "viewInventory" as const,
    },
    {
      key: "pendingPurchaseOrders",
      label: t("pendingPurchaseOrders"),
      value: business?.pendingPurchaseOrdersCount ?? pendingOrders.length,
      href: "/purchase-orders",
      variant: "muted" as const,
      permission: "viewPurchaseOrders" as const,
    },
    {
      key: "failedReceipts",
      label: t("failedReceipts"),
      value: business?.failedReceiptsCount ?? 0,
      href: "/pos/receipts",
      variant: "danger" as const,
      permission: "viewReports" as const,
    },
  ];
  const visibleAttentionItems = attentionItems.filter((item) =>
    hasPermission(access, item.permission) && item.value > 0,
  );
  const quickActions: Array<{
    key: string;
    href: string;
    label: string;
    icon?: ComponentType<{ className?: string }>;
    permission: AppPermission;
    variant?: "secondary";
  }> = [
    {
      key: "startSale",
      href: "/pos/sell",
      label: t("startSale"),
      icon: PosIcon,
      permission: "usePos",
    },
    {
      key: "addProduct",
      href: "/products/new",
      label: t("addProduct"),
      icon: AddIcon,
      permission: "manageProducts",
      variant: "secondary",
    },
    {
      key: "receiveStock",
      href: "/inventory/receiving",
      label: t("receiveStock"),
      icon: ReceiveIcon,
      permission: "viewInventory",
      variant: "secondary",
    },
    {
      key: "transferStock",
      href: "/inventory/transfers",
      label: t("transferStock"),
      icon: TransferIcon,
      permission: "viewInventory",
      variant: "secondary",
    },
    {
      key: "writeOffStock",
      href: "/inventory/write-offs",
      label: t("writeOffStock"),
      icon: InventoryIcon,
      permission: "viewInventory",
      variant: "secondary",
    },
    {
      key: "importProducts",
      href: "/settings/import",
      label: t("importProducts"),
      icon: UploadIcon,
      permission: "manageImports",
      variant: "secondary",
    },
    {
      key: "productMovement",
      href: "/inventory/movements",
      label: t("productMovement"),
      icon: ProductMovementIcon,
      permission: "viewInventory",
      variant: "secondary",
    },
  ];
  const visibleQuickActions = quickActions.filter((action) =>
    hasPermission(access, action.permission),
  );
  const mobileQuickActions: Array<{
    key: string;
    href: string;
    label: string;
    icon?: ComponentType<{ className?: string }>;
    permission: AppPermission;
    variant?: "primary" | "secondary" | "warning";
  }> = [
    {
      key: "mobile-start-sale",
      href: "/pos/sell",
      label: t("startSale"),
      icon: PosIcon,
      permission: "usePos",
      variant: "primary",
    },
    {
      key: "mobile-add-product",
      href: "/products/new",
      label: t("addProduct"),
      icon: AddIcon,
      permission: "manageProducts",
    },
    {
      key: "mobile-receiving",
      href: "/inventory/receiving",
      label: tInventory("stockReceiving"),
      icon: ReceiveIcon,
      permission: "viewInventory",
    },
    {
      key: "mobile-customer",
      href: "/customers",
      label: tNav("customers"),
      icon: CustomerDatabaseIcon,
      permission: "manageCustomers",
    },
    {
      key: "mobile-printing",
      href: "/settings/printing",
      label: tNav("printing"),
      icon: PrintIcon,
      permission: "manageSettings",
    },
  ];
  const visibleMobileQuickActions = mobileQuickActions.filter((action) =>
    hasPermission(access, action.permission),
  );
  const mobileAlertItems = visibleAttentionItems.filter((item) => item.value > 0).slice(0, 4);
  const mobileRecentActivity = activity.slice(0, 4);

  return (
    <div>
      <div className="space-y-4 md:hidden">
        {dashboardQuery.error ? (
          <p className="text-sm text-danger">{translateError(tErrors, dashboardQuery.error)}</p>
        ) : null}

        <section className="rounded-md border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tCommon("store")}
              </p>
              <h1 className="mt-1 truncate text-xl font-semibold text-foreground">
                {selectedStore?.name ?? tCommon("selectStore")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{currencyCode}</p>
            </div>
            {(business?.openShiftsCount ?? 0) > 0 ? (
              <Badge variant="success">{t("openShifts")}</Badge>
            ) : (
              <Badge variant="muted">{formatNumber(0, locale)}</Badge>
            )}
          </div>
          {dashboardQuery.data?.stores.length ? (
            <div className="mt-4">
              <Select value={storeId ?? ""} onValueChange={setRequestedStoreId}>
                <SelectTrigger data-tour="dashboard-mobile-store-filter" className="min-h-11">
                  <SelectValue placeholder={tCommon("selectStore")} />
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
          ) : null}
          {session?.user?.emailVerified === false ? (
            <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
              {tNav("emailUnverifiedTitle")}
            </p>
          ) : null}
        </section>

        <section className="space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary/80">
              {t("businessOverview")}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">{t("businessSubtitle")}</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MobileTaskCard
              label={t("todaySales")}
              value={formatStoreMoney(business?.todaySalesKgs ?? 0)}
              description={t("todaySalesHint")}
            />
            <MobileTaskCard
              label={t("receiptsCount")}
              value={formatNumber(business?.receiptsCount ?? 0, locale)}
              description={t("receiptsHint")}
            />
            <MobileTaskCard
              label={t("lowStock")}
              value={formatNumber(business?.lowStockCount ?? 0, locale)}
              description={t("lowStockHint")}
              href="/inventory?stockFilter=lowStock"
              variant={(business?.lowStockCount ?? 0) > 0 ? "warning" : "default"}
            />
            <MobileTaskCard
              label={t("openShifts")}
              value={formatNumber(business?.openShiftsCount ?? 0, locale)}
              description={t("openShiftsHint")}
              href="/pos"
              variant={(business?.openShiftsCount ?? 0) > 0 ? "success" : "default"}
            />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">{t("quickActions")}</h2>
          <div className="grid gap-2">
            {visibleMobileQuickActions.map((action) => (
              <MobileQuickActionButton
                key={action.key}
                href={action.href}
                label={action.label}
                icon={action.icon}
                variant={action.variant}
              />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">{t("needsAttention")}</h2>
          {mobileAlertItems.length ? (
            <div className="grid gap-2">
              {mobileAlertItems.map((item) => (
                <MobileTaskCard
                  key={item.key}
                  label={item.label}
                  value={formatNumber(item.value, locale)}
                  href={item.href}
                  variant={item.variant === "danger" ? "danger" : "warning"}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-14 items-center gap-2 rounded-md border border-border bg-card px-3 py-3 text-sm text-muted-foreground">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {t("noAttentionTasks")}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">{t("recentActivity")}</h2>
          {activityQuery.isLoading ? (
            loadingState
          ) : mobileRecentActivity.length ? (
            <div className="grid gap-2">
              {mobileRecentActivity.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border border-border bg-card p-3 shadow-sm"
                >
                  <p className="text-sm font-semibold text-foreground">
                    {item.summaryKey
                      ? tAudit(item.summaryKey, item.summaryValues ?? {})
                      : tAudit("fallback")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.actor?.name ?? item.actor?.email ?? tAudit("systemActor")} •{" "}
                    {formatDateTime(item.createdAt, locale)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-14 items-center gap-2 rounded-md border border-border bg-card px-3 py-3 text-sm text-muted-foreground">
              <EmptyIcon className="h-4 w-4" aria-hidden />
              {t("noActivity")}
            </div>
          )}
        </section>
      </div>

      <div className="hidden md:block">
        <PageHeader
          title={t("title")}
          subtitle={t("businessSubtitle")}
          action={
            dashboardQuery.data?.stores.length ? (
              <div className="w-full sm:w-72">
                <Select value={storeId ?? ""} onValueChange={setRequestedStoreId}>
                  <SelectTrigger data-tour="dashboard-store-filter" className="h-11 bg-card">
                    <SelectValue placeholder={tCommon("selectStore")} />
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
            ) : undefined
          }
        />
        {dashboardQuery.error ? (
          <p className="mb-6 text-sm text-danger">
            {translateError(tErrors, dashboardQuery.error)}
          </p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {kpis.map((kpi, index) => {
            const content = (
              <>
                <div className="flex min-h-7 items-start justify-between gap-3">
                  <p className="text-sm font-medium text-muted-foreground">{kpi.label}</p>
                  {"trend" in kpi ? renderTrendBadge(kpi.trend) : null}
                </div>
                <p className={cn("mt-4 text-2xl font-bold tracking-tight", kpi.valueClassName)}>
                  {kpi.value}
                </p>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{kpi.hint}</p>
              </>
            );

            return (
              <Card
                key={kpi.key}
                className={cn(
                  "min-h-36 border-border/70 bg-card/95 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
                  index === 0 && "border-primary/25 bg-primary/5",
                  kpi.href && "hover:border-primary/30",
                )}
              >
                <CardContent className="p-5">
                  {kpi.href ? (
                    <Link
                      href={kpi.href}
                      className="block rounded-lg outline-none ring-ring transition focus-visible:ring-2"
                    >
                      {content}
                    </Link>
                  ) : (
                    content
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-12">
          <Card className="overflow-hidden xl:col-span-8">
            <CardHeader className="flex flex-col items-start justify-between gap-3 bg-transparent sm:flex-row sm:items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
                  {t("businessOverview")}
                </p>
                <CardTitle className="mt-1 text-2xl">
                  {t("salesLast7Days")}
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{t("salesSeriesHint")}</p>
              </div>
              <Badge variant="muted">
                {t("last7Days")} · {formatNumber(seriesTotalReceipts, locale)} {t("receiptsCount")}
              </Badge>
            </CardHeader>
            <CardContent>
              {dashboardQuery.isLoading ? (
                loadingState
              ) : hasSalesSeries ? (
                <div className="rounded-xl border border-border/70 bg-muted/30 p-5">
                  <div className="flex min-h-[15rem] items-end justify-between gap-3">
                    {salesSeries.map((item) => {
                      const height = seriesMaxSales > 0 ? (item.salesKgs / seriesMaxSales) * 100 : 0;
                      return (
                        <div key={item.date} className="flex min-w-0 flex-1 flex-col gap-2">
                          <div className="flex h-[12rem] items-end rounded-lg bg-background/80 p-1 shadow-inner">
                            <div
                              className="w-full rounded-md bg-primary shadow-[0_10px_24px_hsl(var(--primary)/0.20)]"
                              style={{ height: `${Math.max(height, 4)}%` }}
                            />
                          </div>
                          <div className="min-w-0 text-center">
                            <p className="truncate text-[11px] font-medium text-foreground">
                              {formatSeriesDate(item.date)}
                            </p>
                            <p className="truncate text-[10px] text-muted-foreground">
                              {formatCompactStoreMoney(item.salesKgs)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[19rem] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/25 px-6 text-center">
                  <EmptyIcon className="h-8 w-8 text-muted-foreground" aria-hidden />
                  <div>
                    <p className="font-semibold text-foreground">{t("noSalesForPeriod")}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{t("businessOverviewHint")}</p>
                  </div>
                  {hasPermission(access, "usePos") ? (
                    <Button asChild size="sm">
                      <Link href="/pos/sell">{t("startSale")}</Link>
                    </Button>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="xl:col-span-4">
            <CardHeader className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div>
                <CardTitle>{t("topProducts")}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{t("topProductsHint")}</p>
              </div>
              <Badge variant="muted">{t("last7Days")}</Badge>
            </CardHeader>
            <CardContent>
              {dashboardQuery.isLoading ? (
                loadingState
              ) : topProducts.length ? (
                <div className="space-y-2">
                  {topProducts.map((product, index) => (
                    <Link
                      key={product.productId}
                      href={`/products?query=${encodeURIComponent(product.sku ?? product.name)}`}
                      className="flex min-h-14 items-center justify-between gap-3 rounded-xl bg-muted/35 px-4 py-3 text-sm transition hover:bg-primary/5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{product.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {product.sku ?? tCommon("notAvailable")}
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold text-foreground">
                          {formatStoreMoney(product.revenueKgs)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(product.quantity, locale)} {t("quantitySold")}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl bg-muted/35 px-4 text-center text-sm text-muted-foreground">
                  <EmptyIcon className="h-5 w-5" aria-hidden />
                  {t("noTopProducts")}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="xl:col-span-4">
            <CardHeader>
              <CardTitle>{t("quickActions")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {visibleQuickActions.map((action, index) => {
                const Icon = action.icon;
                return (
                  <Button
                    key={action.key}
                    asChild
                    variant={index === 0 ? undefined : action.variant}
                    className="h-11 justify-start"
                  >
                    <Link href={action.href}>
                      {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
                      {action.label}
                    </Link>
                  </Button>
                );
              })}
            </CardContent>
          </Card>

          <Card className="xl:col-span-8">
            <CardHeader>
              <CardTitle>{t("needsAttention")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {visibleAttentionItems.length ? (
                visibleAttentionItems.map((item) => (
                  <Link
                    key={item.key}
                    href={item.href}
                    className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/35 px-4 py-3 text-sm transition hover:border-primary/35 hover:bg-primary/5"
                  >
                    <span className="font-semibold text-foreground">{item.label}</span>
                    <Badge variant={item.variant}>{formatNumber(item.value, locale)}</Badge>
                  </Link>
                ))
              ) : (
                <div className="col-span-full flex min-h-24 items-center justify-center gap-2 rounded-xl bg-muted/35 text-sm text-muted-foreground">
                  <EmptyIcon className="h-4 w-4" aria-hidden />
                  {t("noAttentionTasks")}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="xl:col-span-5">
            <CardHeader className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div>
                <CardTitle>{t("lowStockProducts")}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{t("lowStockHint")}</p>
              </div>
              <Badge variant={(business?.lowStockCount ?? 0) > 0 ? "warning" : "muted"}>
                {formatNumber(business?.lowStockCount ?? 0, locale)}
              </Badge>
            </CardHeader>
            <CardContent>
              {dashboardQuery.isLoading ? (
                loadingState
              ) : lowStockProducts.length ? (
                <div className="space-y-2">
                  {lowStockProducts.map((item) => (
                    <Link
                      key={item.snapshot.id}
                      href={`/products?query=${encodeURIComponent(item.product.sku || item.product.name)}`}
                      className="flex min-h-14 items-center justify-between gap-3 rounded-xl bg-muted/35 px-4 py-3 text-sm transition hover:bg-primary/5"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">{item.product.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.product.sku}
                          {item.variant?.name ? ` · ${item.variant.name}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold text-warning">
                          {formatNumber(item.snapshot.onHand, locale)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("currentVsMinimum", {
                            min: formatNumber(item.minStock, locale),
                          })}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-24 items-center justify-center gap-2 rounded-xl bg-muted/35 text-sm text-muted-foreground">
                  <EmptyIcon className="h-4 w-4" aria-hidden />
                  {t("noLowStockProducts")}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="xl:col-span-3">
            <CardHeader className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center sm:gap-3">
              <CardTitle>{t("pendingPurchaseOrders")}</CardTitle>
              <Badge variant="muted">{formatNumber(pendingOrders.length, locale)}</Badge>
            </CardHeader>
            <CardContent>
              {dashboardQuery.isLoading ? (
                loadingState
              ) : pendingOrders.length ? (
                <div className="space-y-2">
                  {pendingOrders.map((po) => (
                    <div
                      key={po.id}
                      className="flex min-h-14 items-center justify-between gap-3 rounded-xl bg-muted/35 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {po.supplier?.name ?? tCommon("supplierUnassigned")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(po.createdAt, locale)}
                        </p>
                      </div>
                      <Badge variant={statusVariant(po.status)}>{statusLabel(po.status)}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-24 items-center justify-center gap-2 rounded-xl bg-muted/35 text-sm text-muted-foreground">
                  <EmptyIcon className="h-4 w-4" aria-hidden />
                  {t("noPending")}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="xl:col-span-4">
            <CardHeader className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center sm:gap-3">
              <CardTitle>{t("recentActivity")}</CardTitle>
              <Badge variant="muted">{formatNumber(activity.length, locale)}</Badge>
            </CardHeader>
            <CardContent>
              {activityQuery.isLoading ? (
                loadingState
              ) : activity.length ? (
                <div className="space-y-2">
                  {activity.map((item) => (
                    <div key={item.id} className="rounded-xl bg-muted/35 px-4 py-3">
                      <p className="text-sm font-semibold text-foreground">
                        {item.summaryKey
                          ? tAudit(item.summaryKey, item.summaryValues ?? {})
                          : tAudit("fallback")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.actor?.name ?? item.actor?.email ?? tAudit("systemActor")} •{" "}
                        {formatDateTime(item.createdAt, locale)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-24 items-center justify-center gap-2 rounded-xl bg-muted/35 text-sm text-muted-foreground">
                  <EmptyIcon className="h-4 w-4" aria-hidden />
                  {t("noActivity")}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
