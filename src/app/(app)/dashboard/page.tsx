"use client";

import { useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
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
  PrintIcon,
  ReceiveIcon,
  PosIcon,
  PurchaseOrdersIcon,
} from "@/components/icons";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/i18nFormat";
import {
  convertFromKgs,
  normalizeCurrencyCode,
  normalizeCurrencyRateKgsPerUnit,
} from "@/lib/currency";
import { getPurchaseOrderStatusLabel } from "@/lib/i18n/status";
import { hasPermission, type AppPermission, type RoleAccess } from "@/lib/roleAccess";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useSse } from "@/lib/useSse";

const DashboardPage = () => {
  const t = useTranslations("dashboard");
  const tAudit = useTranslations("audit");
  const tOrders = useTranslations("purchaseOrders");
  const tCommon = useTranslations("common");
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

  const loadingState = (
    <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner className="h-4 w-4" />
      {tCommon("loading")}
    </div>
  );

  const kpis = [
    {
      key: "todaySales",
      label: t("todaySales"),
      value: formatStoreMoney(business?.todaySalesKgs ?? 0),
      hint: t("todaySalesHint"),
      valueClassName: "text-foreground",
    },
    {
      key: "receiptsCount",
      label: t("receiptsCount"),
      value: formatNumber(business?.receiptsCount ?? 0, locale),
      hint: t("receiptsHint"),
      valueClassName: "text-foreground",
    },
    {
      key: "averageReceipt",
      label: t("averageReceipt"),
      value: formatStoreMoney(business?.averageReceiptKgs ?? 0),
      hint: t("averageReceiptHint"),
      valueClassName: "text-foreground",
    },
    {
      key: "grossProfit",
      label: t("grossProfit"),
      value:
        business?.grossProfitKgs === null || business?.grossProfitKgs === undefined
          ? tCommon("notAvailable")
          : formatStoreMoney(business.grossProfitKgs),
      hint:
        business?.grossMarginPercent === null || business?.grossMarginPercent === undefined
          ? t("grossProfitHint")
          : t("grossMargin", {
              value: formatNumber(business.grossMarginPercent, locale, {
                maximumFractionDigits: 1,
              }),
            }),
      valueClassName: "text-foreground",
    },
    {
      key: "openShifts",
      label: t("openShifts"),
      value: formatNumber(business?.openShiftsCount ?? 0, locale),
      hint: t("openShiftsHint"),
      valueClassName: "text-foreground",
    },
    {
      key: "lowStockCount",
      label: t("lowStock"),
      value: formatNumber(business?.lowStockCount ?? 0, locale),
      hint: t("lowStockHint"),
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
      href: "/inventory",
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
    hasPermission(access, item.permission),
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
      href: "/pos",
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
      href: "/inventory",
      label: t("receiveStock"),
      icon: ReceiveIcon,
      permission: "viewInventory",
      variant: "secondary",
    },
    {
      key: "printLabels",
      href: "/products",
      label: t("printLabels"),
      icon: PrintIcon,
      permission: "viewProducts",
      variant: "secondary",
    },
    {
      key: "createPurchaseOrder",
      href: "/purchase-orders/new",
      label: t("createPurchaseOrder"),
      icon: PurchaseOrdersIcon,
      permission: "viewPurchaseOrders",
      variant: "secondary",
    },
    {
      key: "viewReports",
      href: "/reports",
      label: t("viewReports"),
      permission: "viewReports",
      variant: "secondary",
    },
  ];
  const visibleQuickActions = quickActions.filter((action) =>
    hasPermission(access, action.permission),
  );

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("businessSubtitle")} />
      {dashboardQuery.error ? (
        <p className="mb-6 text-sm text-danger">{translateError(tErrors, dashboardQuery.error)}</p>
      ) : null}

      <Card>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary/80">
                {t("businessOverview")}
              </p>
              <h3 className="text-xl font-semibold text-foreground">
                {selectedStore?.name ?? tCommon("selectStore")}
              </h3>
              <p className="text-sm text-muted-foreground">{t("businessOverviewHint")}</p>
            </div>

            <div className="w-full sm:max-w-xs">
              <Select value={storeId ?? ""} onValueChange={setRequestedStoreId}>
                <SelectTrigger data-tour="dashboard-store-filter">
                  <SelectValue placeholder={tCommon("selectStore")} />
                </SelectTrigger>
                <SelectContent>
                  {dashboardQuery.data?.stores.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {kpis.map((kpi) => (
              <div key={kpi.key} className="border border-border/80 bg-card p-3">
                <p className="text-xs font-medium text-muted-foreground">{kpi.label}</p>
                <p className={`mt-2 text-xl font-semibold leading-none ${kpi.valueClassName}`}>
                  {kpi.value}
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">{kpi.hint}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 md:grid-cols-6 xl:grid-cols-12">
        <Card className="h-full md:col-span-3 xl:col-span-4">
          <CardHeader>
            <CardTitle>{t("quickActions")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {visibleQuickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Button key={action.key} asChild variant={action.variant}>
                  <Link href={action.href}>
                    {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
                    {action.label}
                  </Link>
                </Button>
              );
            })}
          </CardContent>
        </Card>

        <Card className="h-full md:col-span-3 xl:col-span-8">
          <CardHeader>
            <CardTitle>{t("needsAttention")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {visibleAttentionItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="flex items-center justify-between gap-3 border border-border/80 bg-secondary/20 px-3 py-2 text-sm transition hover:bg-secondary/40"
              >
                <span className="text-foreground">{item.label}</span>
                <Badge variant={item.value > 0 ? item.variant : "muted"}>
                  {formatNumber(item.value, locale)}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="h-full md:col-span-3 xl:col-span-5">
          <CardHeader className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center sm:gap-3">
            <CardTitle>{t("pendingPurchaseOrders")}</CardTitle>
            <Badge variant="muted">{formatNumber(pendingOrders.length, locale)}</Badge>
          </CardHeader>
          <CardContent>
            {dashboardQuery.isLoading ? (
              loadingState
            ) : pendingOrders.length ? (
              <div className="space-y-3">
                {pendingOrders.map((po) => (
                  <div
                    key={po.id}
                    className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
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
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noPending")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="h-full md:col-span-6 xl:col-span-7">
          <CardHeader className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center sm:gap-3">
            <CardTitle>{t("recentActivity")}</CardTitle>
            <Badge variant="muted">{formatNumber(activity.length, locale)}</Badge>
          </CardHeader>
          <CardContent>
            {activityQuery.isLoading ? (
              loadingState
            ) : activity.length ? (
              <div className="space-y-3">
                {activity.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-none border border-border/80 bg-secondary/30 p-3"
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
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noActivity")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default DashboardPage;
