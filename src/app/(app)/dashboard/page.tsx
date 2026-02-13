"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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
  StatusPendingIcon,
  StatusWarningIcon,
  StatusSuccessIcon,
  StatusDangerIcon,
  MetricsIcon,
} from "@/components/icons";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { getPurchaseOrderStatusLabel } from "@/lib/i18n/status";
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
  const storesQuery = trpc.stores.list.useQuery();
  const [storeId, setStoreId] = useState<string | null>(null);

  useEffect(() => {
    if (!storeId && storesQuery.data?.[0]) {
      setStoreId(storesQuery.data[0].id);
    }
  }, [storeId, storesQuery.data]);

  const summaryQuery = trpc.dashboard.summary.useQuery(
    { storeId: storeId ?? "" },
    { enabled: Boolean(storeId) },
  );

  useSse({
    "inventory.updated": () => summaryQuery.refetch(),
    "purchaseOrder.updated": () => summaryQuery.refetch(),
    "lowStock.triggered": () => summaryQuery.refetch(),
  });

  const selectedStore = useMemo(
    () => storesQuery.data?.find((store) => store.id === storeId) ?? null,
    [storesQuery.data, storeId],
  );

  const lowStockItems = summaryQuery.data?.lowStock ?? [];
  const pendingOrders = summaryQuery.data?.pendingPurchaseOrders ?? [];
  const activity = summaryQuery.data?.recentActivity ?? [];

  const statusLabel = (status: string) => getPurchaseOrderStatusLabel(tOrders, status);

  const statusIcon = (status: string) => {
    switch (status) {
      case "RECEIVED":
        return StatusSuccessIcon;
      case "CANCELLED":
        return StatusDangerIcon;
      case "APPROVED":
      case "SUBMITTED":
      case "DRAFT":
      default:
        return StatusPendingIcon;
    }
  };

  const statusVariant = (status: string) => {
    switch (status) {
      case "RECEIVED":
        return "success";
      case "CANCELLED":
        return "danger";
      default:
        return "warning";
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
      key: "lowStock",
      label: t("lowStock"),
      value: lowStockItems.length,
      icon: StatusWarningIcon,
      valueClassName: "text-warning",
      iconClassName: "text-warning",
    },
    {
      key: "pending",
      label: t("pendingPurchaseOrders"),
      value: pendingOrders.length,
      icon: StatusPendingIcon,
      valueClassName: "text-primary",
      iconClassName: "text-primary",
    },
    {
      key: "activity",
      label: t("recentActivity"),
      value: activity.length,
      icon: MetricsIcon,
      valueClassName: "text-success",
      iconClassName: "text-success",
    },
  ];

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {summaryQuery.error ? (
        <p className="mb-6 text-sm text-danger">
          {translateError(tErrors, summaryQuery.error)}
        </p>
      ) : null}

      <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card">
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary/80">
                {t("title")}
              </p>
              <h3 className="text-xl font-semibold text-foreground">
                {selectedStore?.name ?? tCommon("selectStore")}
              </h3>
              <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
            </div>

            <div className="w-full sm:max-w-xs">
              <Select value={storeId ?? ""} onValueChange={setStoreId}>
                <SelectTrigger data-tour="dashboard-store-filter">
                  <SelectValue placeholder={tCommon("selectStore")} />
                </SelectTrigger>
                <SelectContent>
                  {storesQuery.data?.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {kpis.map((kpi) => {
              const Icon = kpi.icon;
              return (
                <div
                  key={kpi.key}
                  className="rounded-lg border border-border/80 bg-card/90 p-3 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">{kpi.label}</p>
                    <Icon className={`h-4 w-4 ${kpi.iconClassName}`} aria-hidden />
                  </div>
                  <p className={`mt-2 text-2xl font-semibold leading-none ${kpi.valueClassName}`}>
                    {formatNumber(kpi.value, locale)}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 md:grid-cols-6 xl:grid-cols-12">
        <Card className="h-full md:col-span-6 xl:col-span-7">
          <CardHeader className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center sm:gap-3">
            <CardTitle className="flex items-center gap-2">
              <StatusWarningIcon className="h-4 w-4 text-warning" aria-hidden />
              {t("lowStock")}
            </CardTitle>
            <Badge variant="warning">{formatNumber(lowStockItems.length, locale)}</Badge>
          </CardHeader>
          <CardContent>
            {summaryQuery.isLoading ? (
              loadingState
            ) : lowStockItems.length ? (
              <div className="space-y-3">
                {lowStockItems.map((item) => (
                  <div
                    key={item.snapshot.id}
                    className="rounded-lg border border-border/80 bg-secondary/30 p-3"
                  >
                    <p className="text-sm font-semibold text-foreground">
                      {item.product.name}
                      {item.variant?.name ? ` • ${item.variant.name}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("onHand")}: {formatNumber(item.snapshot.onHand, locale)} • {t("minStock")}:{" "}
                      {formatNumber(item.minStock, locale)}
                    </p>
                    {item.reorder && item.reorder.suggestedOrderQty > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("suggestedOrder")}: {formatNumber(item.reorder.suggestedOrderQty, locale)}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noLowStock")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="h-full md:col-span-3 xl:col-span-5">
          <CardHeader className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center sm:gap-3">
            <CardTitle className="flex items-center gap-2">
              <StatusPendingIcon className="h-4 w-4 text-primary" aria-hidden />
              {t("pendingPurchaseOrders")}
            </CardTitle>
            <Badge variant="muted">{formatNumber(pendingOrders.length, locale)}</Badge>
          </CardHeader>
          <CardContent>
            {summaryQuery.isLoading ? (
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
                    <Badge variant={statusVariant(po.status)}>
                      {(() => {
                        const Icon = statusIcon(po.status);
                        return <Icon className="h-3 w-3" aria-hidden />;
                      })()}
                      {statusLabel(po.status)}
                    </Badge>
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

        <Card className="h-full md:col-span-6 xl:col-span-12">
          <CardHeader className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center sm:gap-3">
            <CardTitle className="flex items-center gap-2">
              <MetricsIcon className="h-4 w-4 text-success" aria-hidden />
              {t("recentActivity")}
            </CardTitle>
            <Badge variant="muted">{formatNumber(activity.length, locale)}</Badge>
          </CardHeader>
          <CardContent>
            {summaryQuery.isLoading ? (
              loadingState
            ) : activity.length ? (
              <div className="space-y-3">
                {activity.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border/80 bg-secondary/30 p-3">
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
