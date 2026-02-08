"use client";

import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/i18nFormat";

const BillingPage = () => {
  const t = useTranslations("billing");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const isForbidden = status === "authenticated" && !isAdmin;

  const billingQuery = trpc.billing.get.useQuery(undefined, { enabled: status === "authenticated" });
  const statusKeyMap = {
    ACTIVE: "active",
    PAST_DUE: "past_due",
    CANCELED: "canceled",
  } as const;
  const planBadgeVariant = {
    STARTER: "warning",
    BUSINESS: "muted",
    ENTERPRISE: "success",
  } as const;

  if (isForbidden) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-red-500">{tErrors("forbidden")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {billingQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Spinner className="h-4 w-4" />
          {tCommon("loading")}
        </div>
      ) : billingQuery.data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("planTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <Badge variant={planBadgeVariant[billingQuery.data.planTier]}>
                  {t(`plans.${billingQuery.data.planTier.toLowerCase()}`)}
                </Badge>
                <Badge variant={billingQuery.data.subscriptionStatus === "ACTIVE" ? "muted" : "danger"}>
                  {t(`subscriptionStatuses.${statusKeyMap[billingQuery.data.subscriptionStatus]}`)}
                </Badge>
                {billingQuery.data.trialEndsAt ? (
                  <span>
                    {t("trialEndsAt", {
                      date: formatDateTime(billingQuery.data.trialEndsAt, locale),
                    })}
                  </span>
                ) : null}
              </div>
              {billingQuery.data.currentPeriodEndsAt ? (
                <p>
                  {t("currentPeriodEndsAt", {
                    date: formatDateTime(billingQuery.data.currentPeriodEndsAt, locale),
                  })}
                </p>
              ) : null}
              {billingQuery.data.trialExpired ? (
                <p className="text-sm text-amber-700">{t("trialExpired")}</p>
              ) : (
                <p>{t("trialActive")}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("usageTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-gray-600">
              <p>
                {t("usageStores", {
                  count: billingQuery.data.usage.stores,
                  limit: billingQuery.data.limits.maxStores,
                })}
              </p>
              <p>
                {t("usageUsers", {
                  count: billingQuery.data.usage.users,
                  limit: billingQuery.data.limits.maxUsers,
                })}
              </p>
              <p>
                {t("usageProducts", {
                  count: billingQuery.data.usage.products,
                  limit: billingQuery.data.limits.maxProducts,
                })}
              </p>
              <p>
                {t("planPrice", {
                  amount: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
                    billingQuery.data.monthlyPriceKgs,
                  ),
                })}
              </p>
              {billingQuery.data.features.length ? (
                <p className="text-xs text-gray-500">
                  {t("featuresEnabled", {
                    value: billingQuery.data.features
                      .map((feature) => t(`features.${feature}`))
                      .join(", "),
                  })}
                </p>
              ) : (
                <p className="text-xs text-gray-500">{t("featuresNone")}</p>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t("ctaTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-gray-600">
              <p>{t("ctaHint")}</p>
              <p className="text-sm font-semibold text-ink">{t("ctaContact")}</p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <p className="text-sm text-gray-500">{t("empty")}</p>
      )}
    </div>
  );
};

export default BillingPage;
