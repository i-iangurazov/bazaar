"use client";

import { useMemo } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import { formatCurrencyKGS, formatDateTime, formatNumber } from "@/lib/i18nFormat";

const AdminMetricsPage = () => {
  const t = useTranslations("adminMetrics");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const isForbidden = status === "authenticated" && !isAdmin;

  const metricsQuery = trpc.adminMetrics.get.useQuery(undefined, { enabled: isAdmin });

  const firstValueLabel = useMemo(() => {
    const type = metricsQuery.data?.firstValueType;
    if (!type) {
      return null;
    }
    return t(`eventLabels.${type}`);
  }, [metricsQuery.data?.firstValueType, t]);

  const formatPercent = (value: number | null | undefined) => {
    if (value === null || value === undefined) {
      return tCommon("notAvailable");
    }
    return `${formatNumber(value, locale)}%`;
  };

  if (isForbidden) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-danger">{tErrors("forbidden")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {metricsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {tCommon("loading")}
        </div>
      ) : metricsQuery.data ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>{t("onboardingTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Badge variant={metricsQuery.data.onboardingCompleted ? "success" : "warning"}>
                  {metricsQuery.data.onboardingCompleted ? t("completed") : t("incomplete")}
                </Badge>
                {metricsQuery.data.onboardingCompletedAt ? (
                  <span>{formatDateTime(metricsQuery.data.onboardingCompletedAt, locale)}</span>
                ) : null}
              </div>
              {metricsQuery.data.onboardingStartedAt ? (
                <p>
                  {t("onboardingStarted", {
                    date: formatDateTime(metricsQuery.data.onboardingStartedAt, locale),
                  })}
                </p>
              ) : (
                <p>{t("onboardingNotStarted")}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("firstValueTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {metricsQuery.data.firstValueAt ? (
                <>
                  <p>
                    {t("firstValueAt", {
                      date: formatDateTime(metricsQuery.data.firstValueAt, locale),
                    })}
                  </p>
                  {firstValueLabel ? <p>{firstValueLabel}</p> : null}
                  {metricsQuery.data.timeToFirstValueHours !== null ? (
                    <p>
                      {t("timeToFirstValue", {
                        hours: formatNumber(metricsQuery.data.timeToFirstValueHours, locale),
                      })}
                    </p>
                  ) : null}
                </>
              ) : (
                <p>{t("firstValueMissing")}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("adoptionTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                {t("weeklyActiveUsers", {
                  count: metricsQuery.data.weeklyActiveUsers,
                })}
              </p>
              <p>
                {t("adjustments30d", {
                  count: metricsQuery.data.adjustments30d,
                })}
              </p>
              <p>
                {t("stockoutsCurrent", {
                  count: metricsQuery.data.stockoutsCurrent,
                })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("salesTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                {t("sales7dOrders", {
                  count: metricsQuery.data.sales7d.orders,
                })}
              </p>
              <p>
                {t("sales7dRevenue", {
                  amount: formatCurrencyKGS(metricsQuery.data.sales7d.revenueKgs, locale),
                })}
              </p>
              <p>
                {t("sales30dOrders", {
                  count: metricsQuery.data.sales30d.orders,
                })}
              </p>
              <p>
                {t("sales30dRevenue", {
                  amount: formatCurrencyKGS(metricsQuery.data.sales30d.revenueKgs, locale),
                })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("returnsProfitTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                {t("returns30dOrders", {
                  count: metricsQuery.data.returns30d.orders,
                })}
              </p>
              <p>
                {t("returns30dAmount", {
                  amount: formatCurrencyKGS(metricsQuery.data.returns30d.amountKgs, locale),
                })}
              </p>
              <p>
                {t("refundRate", {
                  rate: formatPercent(metricsQuery.data.returns30d.refundRatePercent),
                })}
              </p>
              <p>
                {t("grossProfit30d", {
                  amount: formatCurrencyKGS(metricsQuery.data.gross30d.profitKgs, locale),
                })}
              </p>
              <p>
                {t("grossMargin30d", {
                  rate: formatPercent(metricsQuery.data.gross30d.marginPercent),
                })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("poPipelineTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                {t("poSubmitted", {
                  count: metricsQuery.data.poPipeline.submitted,
                })}
              </p>
              <p>
                {t("poApproved", {
                  count: metricsQuery.data.poPipeline.approved,
                })}
              </p>
              <p>
                {t("poPartiallyReceived", {
                  count: metricsQuery.data.poPipeline.partiallyReceived,
                })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("kkmHealthTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                {t("kkmNotSentOrders", {
                  count: metricsQuery.data.kkmHealth.notSentOrders,
                })}
              </p>
              <p>
                {t("kkmFailedOrders", {
                  count: metricsQuery.data.kkmHealth.failedOrders,
                })}
              </p>
              <p>
                {t("kkmFiscalQueued", {
                  count: metricsQuery.data.kkmHealth.fiscalQueued,
                })}
              </p>
              <p>
                {t("kkmFiscalProcessing", {
                  count: metricsQuery.data.kkmHealth.fiscalProcessing,
                })}
              </p>
              <p>
                {t("kkmFiscalFailed", {
                  count: metricsQuery.data.kkmHealth.fiscalFailed,
                })}
              </p>
            </CardContent>
          </Card>

          <Card className="xl:col-span-3">
            <CardHeader>
              <CardTitle>{t("topStockoutsTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {metricsQuery.data.topStockouts.length ? (
                <div className="space-y-2 text-sm">
                  {metricsQuery.data.topStockouts.map((item) => (
                    <div
                      key={`${item.storeId}:${item.productId}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.productSku} · {item.storeName}
                        </p>
                      </div>
                      <Badge variant={item.onHand < 0 ? "danger" : "warning"}>
                        {t("stockoutOnHand", { count: item.onHand })}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("topStockoutsEmpty")}</p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </div>
  );
};

export default AdminMetricsPage;
