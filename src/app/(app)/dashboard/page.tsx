"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ActivityIcon,
  EmptyIcon,
  StatusPendingIcon,
  StatusWarningIcon,
  StatusSuccessIcon,
  StatusDangerIcon,
  MetricsIcon,
} from "@/components/icons";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";
import { getPurchaseOrderStatusLabel, getStockMovementLabel } from "@/lib/i18n/status";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useSse } from "@/lib/useSse";

const DashboardPage = () => {
  const t = useTranslations("dashboard");
  const tAudit = useTranslations("audit");
  const tOrders = useTranslations("purchaseOrders");
  const tInventory = useTranslations("inventory");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const storesQuery = trpc.stores.list.useQuery();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);

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

  const movementLabel = (type: string) => getStockMovementLabel(tInventory, type);

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        filters={
          <div className="w-full sm:max-w-xs">
            <Select value={storeId ?? ""} onValueChange={setStoreId}>
              <SelectTrigger>
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
        }
      />
      {summaryQuery.error ? (
        <p className="mb-6 text-sm text-red-500">
          {translateError(tErrors, summaryQuery.error)}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <StatusWarningIcon className="h-4 w-4 text-amber-500" aria-hidden />
              {t("lowStock")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryQuery.isLoading ? (
              <p className="text-sm text-gray-500">{tCommon("loading")}</p>
            ) : summaryQuery.data?.lowStock?.length ? (
              <div className="space-y-4">
                {summaryQuery.data.lowStock.map((item) => (
                  <div key={item.snapshot.id} className="space-y-1">
                    <p className="text-sm font-semibold">
                      {item.product.name}
                      {item.variant?.name ? ` • ${item.variant.name}` : ""}
                    </p>
                    <p className="text-xs text-gray-500">
                      {t("onHand")}: {formatNumber(item.snapshot.onHand, locale)} •{" "}
                      {t("minStock")}: {formatNumber(item.minStock, locale)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noLowStock")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <StatusPendingIcon className="h-4 w-4 text-amber-500" aria-hidden />
              {t("pendingPurchaseOrders")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryQuery.isLoading ? (
              <p className="text-sm text-gray-500">{tCommon("loading")}</p>
            ) : summaryQuery.data?.pendingPurchaseOrders?.length ? (
              <div className="space-y-3">
                {summaryQuery.data.pendingPurchaseOrders.map((po) => (
                  <div key={po.id} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">{po.supplier.name}</p>
                      <p className="text-xs text-gray-500">
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
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noPending")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ActivityIcon className="h-4 w-4 text-ink" aria-hidden />
              {t("recentMovements")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryQuery.isLoading ? (
              <p className="text-sm text-gray-500">{tCommon("loading")}</p>
            ) : summaryQuery.data?.recentMovements?.length ? (
              <div className="space-y-3">
                {summaryQuery.data.recentMovements.map((movement) => (
                  <div key={movement.id} className="text-xs text-gray-500">
                    <p className="font-semibold text-ink">
                      {movementLabel(movement.type)} • {movement.product.name}
                      {movement.variant?.name ? ` (${movement.variant.name})` : ""}
                    </p>
                    <p>
                      {formatNumber(movement.qtyDelta, locale)} •{" "}
                      {formatDateTime(movement.createdAt, locale)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <EmptyIcon className="h-4 w-4" aria-hidden />
                {t("noMovements")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MetricsIcon className="h-4 w-4 text-ink" aria-hidden />
              {t("chartsTitle")}
            </CardTitle>
            <p className="text-sm text-gray-500">{t("chartsSubtitle")}</p>
          </div>
          <Button asChild variant="ghost">
            <Link href="/reports/analytics">{t("chartsAction")}</Link>
          </Button>
        </CardHeader>
      </Card>

      <div className="mt-6 flex justify-center">
        <Button
          type="button"
          variant="ghost"
          className="w-full sm:w-auto"
          onClick={() => setShowMore((prev) => !prev)}
        >
          {showMore ? t("hideMore") : t("showMore")}
        </Button>
      </div>

      {showMore ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ActivityIcon className="h-4 w-4 text-ink" aria-hidden />
                {t("recentActivity")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {summaryQuery.isLoading ? (
                <p className="text-sm text-gray-500">{tCommon("loading")}</p>
              ) : summaryQuery.data?.recentActivity?.length ? (
                <div className="space-y-3">
                  {summaryQuery.data.recentActivity.map((item) => (
                    <div key={item.id} className="text-xs text-gray-500">
                      <p className="font-semibold text-ink">
                        {item.summaryKey
                          ? tAudit(item.summaryKey, item.summaryValues ?? {})
                          : tAudit("fallback")}
                      </p>
                      <p>
                        {item.actor?.name ?? item.actor?.email ?? tAudit("systemActor")} •{" "}
                        {formatDateTime(item.createdAt, locale)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <EmptyIcon className="h-4 w-4" aria-hidden />
                  {t("noActivity")}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
};

export default DashboardPage;
