"use client";

import { useMemo } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import { formatDateTime, formatNumber } from "@/lib/i18nFormat";

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
        <div className="grid gap-4 lg:grid-cols-2">
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
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </div>
  );
};

export default AdminMetricsPage;
