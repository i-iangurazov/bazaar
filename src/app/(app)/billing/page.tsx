"use client";

import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc";
import { formatDateTime } from "@/lib/i18nFormat";
import { translateError } from "@/lib/translateError";

type PlanTier = "STARTER" | "BUSINESS" | "ENTERPRISE";
const planRank: Record<PlanTier, number> = {
  STARTER: 1,
  BUSINESS: 2,
  ENTERPRISE: 3,
};

const baseFeatureKeys = [
  "catalog",
  "inventory",
  "purchaseOrders",
  "salesOrders",
  "priceTags",
] as const;

const BillingPage = () => {
  const t = useTranslations("billing");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const { toast } = useToast();
  const isAdmin = session?.user?.role === "ADMIN";
  const isForbidden = status === "authenticated" && !isAdmin;
  const [requestedPlan, setRequestedPlan] = useState<PlanTier | null>(null);
  const [requestMessage, setRequestMessage] = useState("");

  const billingQuery = trpc.billing.get.useQuery(undefined, { enabled: status === "authenticated" });
  const requestUpgradeMutation = trpc.billing.requestUpgrade.useMutation({
    onSuccess: () => {
      setRequestedPlan(null);
      setRequestMessage("");
      void billingQuery.refetch();
      toast({ variant: "success", description: t("requestSentSuccess") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

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
  const pendingRequest = billingQuery.data?.pendingUpgradeRequest ?? null;
  const currentPlan = billingQuery.data?.planTier ?? null;
  const requestPlanLabel = useMemo(() => {
    if (!requestedPlan) {
      return "";
    }
    return t(`plans.${requestedPlan.toLowerCase()}`);
  }, [requestedPlan, t]);

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

      {billingQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {tCommon("loading")}
        </div>
      ) : billingQuery.data ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("planTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
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
              {pendingRequest ? (
                <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-foreground">
                  <p className="font-semibold">{t("pendingRequestTitle")}</p>
                  <p>
                    {t("pendingRequestDetails", {
                      plan: t(`plans.${String(pendingRequest.requestedPlan).toLowerCase()}`),
                      date: formatDateTime(pendingRequest.createdAt, locale),
                    })}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t("usageTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
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
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t("plansCatalogTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 xl:grid-cols-3">
              {billingQuery.data.planCatalog.map((planItem) => {
                const tier = planItem.planTier as PlanTier;
                const isCurrent = tier === currentPlan;
                const canRequestUpgrade =
                  Boolean(currentPlan) && planRank[tier] > planRank[currentPlan as PlanTier];
                const hasPendingRequest = Boolean(pendingRequest);
                const requestedThisPlan =
                  pendingRequest && pendingRequest.requestedPlan === planItem.plan;

                return (
                  <Card key={planItem.planTier} className="h-full border">
                    <CardHeader className="space-y-2 pb-3">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base">
                          {t(`plans.${tier.toLowerCase()}`)}
                        </CardTitle>
                        {isCurrent ? (
                          <Badge variant="success">{t("currentPlanBadge")}</Badge>
                        ) : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t(`planDescriptions.${tier.toLowerCase()}`)}
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-muted-foreground">
                      <p className="text-base font-semibold text-foreground">
                        {t("planPrice", {
                          amount: new Intl.NumberFormat(locale, {
                            maximumFractionDigits: 0,
                          }).format(planItem.monthlyPriceKgs),
                        })}
                      </p>
                      <div className="space-y-1">
                        <p>
                          {t("usageStores", {
                            count: 0,
                            limit: planItem.limits.maxStores,
                          })}
                        </p>
                        <p>
                          {t("usageUsers", {
                            count: 0,
                            limit: planItem.limits.maxUsers,
                          })}
                        </p>
                        <p>
                          {t("usageProducts", {
                            count: 0,
                            limit: planItem.limits.maxProducts,
                          })}
                        </p>
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t("includesTitle")}
                        </p>
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          {baseFeatureKeys.map((featureKey) => (
                            <li key={featureKey}>• {t(`featuresBase.${featureKey}`)}</li>
                          ))}
                          {planItem.features.map((feature) => (
                            <li key={feature}>• {t(`features.${feature}`)}</li>
                          ))}
                        </ul>
                      </div>
                      {!isCurrent ? (
                        <Button
                          type="button"
                          className="w-full"
                          disabled={!canRequestUpgrade || hasPendingRequest}
                          onClick={() => setRequestedPlan(tier)}
                        >
                          {!canRequestUpgrade
                            ? t("upgradeOnlyHigherPlans")
                            : requestedThisPlan
                            ? t("requestPendingButton")
                            : hasPendingRequest
                              ? t("requestPendingOtherButton")
                              : t("requestUpgrade")}
                        </Button>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </CardContent>
          </Card>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}

      <Modal
        open={Boolean(requestedPlan)}
        onOpenChange={(open) => {
          if (!open) {
            setRequestedPlan(null);
            setRequestMessage("");
          }
        }}
        title={t("requestModalTitle", { plan: requestPlanLabel })}
      >
        {requestedPlan ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              requestUpgradeMutation.mutate({
                requestedPlan,
                message: requestMessage.trim() ? requestMessage.trim() : null,
              });
            }}
          >
            <p className="text-sm text-muted-foreground">{t("requestModalDescription")}</p>
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">{t("requestMessageLabel")}</p>
              <Textarea
                value={requestMessage}
                onChange={(event) => setRequestMessage(event.target.value)}
                rows={4}
                placeholder={t("requestMessagePlaceholder")}
                maxLength={500}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setRequestedPlan(null);
                  setRequestMessage("");
                }}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={requestUpgradeMutation.isLoading}>
                {requestUpgradeMutation.isLoading ? tCommon("loading") : t("requestSubmit")}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
};

export default BillingPage;
