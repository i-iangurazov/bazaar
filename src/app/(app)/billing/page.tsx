"use client";

import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { CheckIcon, LockIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { QueryErrorState } from "@/components/query-error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc";
import { PLAN_CODES, PLAN_FEATURE_CODES, getPlanRank, type PlanCode } from "@/lib/billing/plans";
import { formatDateTime, formatNumber as formatLocaleNumber } from "@/lib/i18nFormat";
import { translateError } from "@/lib/translateError";
import { SubscriptionPayments } from "@/components/billing/subscription-payments";
import { SubscriptionUsage } from "@/components/billing/subscription-usage";
import { SubscriptionAccessNotice } from "@/components/billing/subscription-access-banner";
import { ADDITIONAL_STORE_CAPS, CURRENT_CATALOG_VERSION } from "@/lib/billing/subscriptionPricing";

type PlanTier = PlanCode;
const planOrder = PLAN_CODES;
const featureOrder = PLAN_FEATURE_CODES;
const comparisonFeatures = PLAN_FEATURE_CODES;

const BillingPage = () => {
  const t = useTranslations("billing");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const { toast } = useToast();
  const isAdmin = status === "authenticated" && session?.user?.role === "ADMIN";
  const isForbidden = status === "authenticated" && !isAdmin;
  const [requestedPlan, setRequestedPlan] = useState<PlanTier | null>(null);
  const [requestMessage, setRequestMessage] = useState("");
  const [checkoutPlan, setCheckoutPlan] = useState<PlanCode | null>(null);

  const billingQuery = trpc.billing.get.useQuery(undefined, {
    enabled: isAdmin,
  });
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
    return t(`plans.${requestedPlan.toLowerCase()}.name`);
  }, [requestedPlan, t]);

  const formatNumber = (value: number) =>
    formatLocaleNumber(value, locale, { maximumFractionDigits: 2 });

  if (status !== "authenticated" || isForbidden) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p role={isForbidden ? "alert" : "status"} className="mt-4 text-sm text-danger">
          {isForbidden ? tErrors("forbidden") : tCommon("loading")}
        </p>
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
      ) : billingQuery.isError ? (
        <QueryErrorState error={billingQuery.error} onRetry={() => void billingQuery.refetch()} />
      ) : billingQuery.data ? (
        <div className="space-y-4">
          <SubscriptionAccessNotice
            canManage={isAdmin}
            showBillingLink={false}
            showTrialScope={false}
            state={{
              billingCatalogVersion: billingQuery.data.billingCatalogVersion,
              lifetimeAccess: billingQuery.data.lifetimeAccess,
              subscriptionStatus: billingQuery.data.subscriptionStatus,
              trialActive: billingQuery.data.trialActive,
              trialEndsAt: billingQuery.data.trialEndsAt,
              trialOffer: billingQuery.data.trialOffer,
              access: {
                inGrace: billingQuery.data.inGrace,
                hasAccess: billingQuery.data.hasAccess,
                graceEndsAt: billingQuery.data.graceEndsAt,
              },
            }}
          />
          {billingQuery.data.limitState === "LIMIT_EXCEEDED" ? (
            <Card className="border-warning/40 bg-warning/10">
              <CardHeader>
                <CardTitle className="text-base">{t("limitExceededTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-foreground">
                <p>{t("limitExceededDescription")}</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {billingQuery.data.limitExceeded.stores ? (
                    <li>• {t("limitExceededItems.stores")}</li>
                  ) : null}
                  {billingQuery.data.limitExceeded.products ? (
                    <li>• {t("limitExceededItems.products")}</li>
                  ) : null}
                  {billingQuery.data.limitExceeded.users ? (
                    <li>• {t("limitExceededItems.users")}</li>
                  ) : null}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card data-subscription-overview>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>{t("accessTitle")}</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={planBadgeVariant[billingQuery.data.planTier]}>
                    {billingQuery.data.trialOffer
                      ? t("plans.trial")
                      : t(`plans.${billingQuery.data.planTier.toLowerCase()}.name`)}
                  </Badge>
                  <Badge
                    variant={billingQuery.data.subscriptionStatus === "ACTIVE" ? "muted" : "danger"}
                  >
                    {t(
                      `subscriptionStatuses.${statusKeyMap[billingQuery.data.subscriptionStatus]}`,
                    )}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
                <div className="space-y-1 text-muted-foreground">
                  {billingQuery.data.trialEndsAt &&
                  (billingQuery.data.trialActive || !billingQuery.data.subscriptionActive) ? (
                    <p data-current-trial-end>
                      {t("trialEndsAt", {
                        date: formatDateTime(billingQuery.data.trialEndsAt, locale),
                      })}
                    </p>
                  ) : null}
                  {billingQuery.data.currentPeriodEndsAt &&
                  (!billingQuery.data.trialActive || billingQuery.data.subscriptionActive) ? (
                    <p data-current-subscription-end>
                      {t(billingQuery.data.trialActive ? "accessEndsAt" : "currentPeriodEndsAt", {
                        date: formatDateTime(billingQuery.data.currentPeriodEndsAt, locale),
                      })}
                    </p>
                  ) : null}
                  {billingQuery.data.trialExpired &&
                  (billingQuery.data.billingCatalogVersion !== CURRENT_CATALOG_VERSION ||
                    billingQuery.data.lifetimeAccess ||
                    billingQuery.data.subscriptionStatus === "CANCELED") ? (
                    <p className="text-warning-foreground">{t("trialExpired")}</p>
                  ) : !billingQuery.data.trialActive && billingQuery.data.subscriptionActive ? (
                    <p className="text-success">{t("subscriptionActive")}</p>
                  ) : null}
                </div>
                <p className="font-medium text-foreground">
                  {billingQuery.data.trialOffer
                    ? t("trial.free")
                    : t("planPricePrimary", {
                        amount: formatNumber(billingQuery.data.monthlyPriceKgs),
                      })}
                </p>
              </div>
              <dl className="grid grid-cols-3 gap-3">
                {(
                  [
                    ["stores", billingQuery.data.usage.stores, billingQuery.data.limits.maxStores],
                    [
                      "products",
                      billingQuery.data.usage.products,
                      billingQuery.data.limits.maxProducts,
                    ],
                    ["users", billingQuery.data.usage.users, billingQuery.data.limits.maxUsers],
                  ] as const
                ).map(([resource, used, limit]) => (
                  <div key={resource} className="min-w-0 rounded-md bg-muted/50 px-3 py-2">
                    <dt className="text-xs text-muted-foreground">
                      {t(`comparison.rows.${resource}`)}
                    </dt>
                    <dd className="mt-1 text-base font-semibold tabular-nums text-foreground">
                      {formatNumber(used)}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        / {formatNumber(limit)}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-col gap-4 border-t border-border pt-3 sm:flex-row sm:items-start sm:justify-between">
                <details className="min-w-0 text-sm" data-current-subscription-features>
                  <summary className="cursor-pointer font-medium text-foreground">
                    {t("includesTitle")}
                  </summary>
                  {billingQuery.data.trialActive && billingQuery.data.trialOffer ? (
                    <p className="mt-3 text-sm text-muted-foreground">{t("trial.scope")}</p>
                  ) : null}
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {featureOrder
                      .filter((feature) => billingQuery.data?.featureFlags[feature])
                      .map((feature) => (
                        <li key={feature} className="flex items-start gap-2">
                          <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                          <span>{t(`features.${feature}`)}</span>
                        </li>
                      ))}
                  </ul>
                </details>
                {billingQuery.data.subscriptionBillingMode === "SELF_SERVE" &&
                !billingQuery.data.lifetimeAccess &&
                billingQuery.data.subscriptionStatus !== "CANCELED" ? (
                  <div className="pt-2">
                    <Button asChild>
                      <a href="#subscription-checkout">{t("payments.openCheckout")}</a>
                    </Button>
                  </div>
                ) : null}
              </div>
              {pendingRequest ? (
                <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-foreground">
                  <p className="font-semibold">{t("pendingRequestTitle")}</p>
                  <p>
                    {t("pendingRequestDetails", {
                      plan: t(`plans.${String(pendingRequest.requestedPlan).toLowerCase()}.name`),
                      date: formatDateTime(pendingRequest.createdAt, locale),
                    })}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <SubscriptionPayments
            onUpdated={() => void billingQuery.refetch()}
            selectedPlan={checkoutPlan}
            onPlanSelected={setCheckoutPlan}
          />
          <details
            className="rounded-lg border border-border bg-card p-4 sm:p-5"
            data-subscription-usage-details
          >
            <summary className="cursor-pointer text-sm font-semibold text-foreground">
              {t("usage.title")}
            </summary>
            <div className="mt-4">
              <SubscriptionUsage trial={Boolean(billingQuery.data.trialOffer)} />
            </div>
          </details>

          <Card className="scroll-mt-24 lg:col-span-2" id="plans">
            <CardHeader>
              <CardTitle>{t("plansCatalogTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 xl:grid-cols-3">
              {billingQuery.data.planCatalog.map((planItem) => {
                const tier = planItem.planTier as PlanTier;
                const isCurrent = tier === currentPlan;
                const canRequestUpgrade =
                  billingQuery.data?.subscriptionBillingMode === "MANUAL" &&
                  !billingQuery.data?.lifetimeAccess &&
                  Boolean(currentPlan) &&
                  getPlanRank(tier) > getPlanRank(currentPlan as PlanTier);
                const hasPendingRequest = Boolean(pendingRequest);
                const requestedThisPlan =
                  pendingRequest && pendingRequest.requestedPlan === planItem.plan;
                const canSelectPayment =
                  billingQuery.data?.subscriptionBillingMode === "SELF_SERVE" &&
                  !billingQuery.data.lifetimeAccess &&
                  billingQuery.data.subscriptionStatus !== "CANCELED";

                return (
                  <Card key={planItem.planTier} className="h-full border">
                    <CardHeader className="space-y-2 pb-3">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base">
                          {t(`plans.${tier.toLowerCase()}.name`)}
                        </CardTitle>
                        {isCurrent && !billingQuery.data?.trialOffer ? (
                          <Badge variant="success">{t("currentPlanBadge")}</Badge>
                        ) : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t(`planDescriptions.${tier.toLowerCase()}`)}
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-muted-foreground">
                      <div>
                        <p className="text-base font-semibold text-foreground">
                          {t("planPricePrimary", {
                            amount: formatNumber(planItem.monthlyPriceKgs),
                          })}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p>
                          {t("capacityStores", {
                            limit: planItem.limits.maxStores,
                          })}
                        </p>
                        {billingQuery.data?.billingCatalogVersion === CURRENT_CATALOG_VERSION ? (
                          <p className="text-xs text-primary" data-store-expansion>
                            {ADDITIONAL_STORE_CAPS[tier] > 0
                              ? t("publicPricing.expandStores", {
                                  count: planItem.limits.maxStores + ADDITIONAL_STORE_CAPS[tier],
                                })
                              : t("publicPricing.singleStore")}
                          </p>
                        ) : null}
                        <p>
                          {t("capacityUsers", {
                            limit: planItem.limits.maxUsers,
                          })}
                        </p>
                        <p>
                          {t("capacityProducts", {
                            limit: planItem.limits.maxProducts,
                          })}
                        </p>
                      </div>
                      {canSelectPayment ? (
                        <Button
                          asChild
                          variant={isCurrent ? "secondary" : "default"}
                          className="w-full"
                        >
                          <a href="#subscription-checkout" onClick={() => setCheckoutPlan(tier)}>
                            {t("payments.choosePlan")}
                          </a>
                        </Button>
                      ) : !isCurrent &&
                        billingQuery.data?.subscriptionBillingMode === "MANUAL" &&
                        !billingQuery.data.lifetimeAccess ? (
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

          <Card>
            <details data-billing-comparison>
              <summary className="cursor-pointer p-4 text-sm font-semibold text-foreground sm:p-5">
                {t("comparisonTitle")}
              </summary>
              <CardContent className="overflow-x-auto">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("comparison.columnFeature")}</TableHead>
                      {planOrder.map((plan) => (
                        <TableHead key={plan}>{t(`plans.${plan.toLowerCase()}.name`)}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>{t("comparison.rows.stores")}</TableCell>
                      {planOrder.map((plan) => {
                        const planItem = billingQuery.data?.planCatalog.find(
                          (item) => item.planTier === plan,
                        );
                        return (
                          <TableCell key={plan}>
                            {planItem ? planItem.limits.maxStores : "-"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                    {billingQuery.data.billingCatalogVersion === CURRENT_CATALOG_VERSION ? (
                      <TableRow>
                        <TableCell>{t("publicPricing.maxStores")}</TableCell>
                        {planOrder.map((plan) => (
                          <TableCell key={plan}>{1 + ADDITIONAL_STORE_CAPS[plan]}</TableCell>
                        ))}
                      </TableRow>
                    ) : null}
                    <TableRow>
                      <TableCell>{t("comparison.rows.products")}</TableCell>
                      {planOrder.map((plan) => {
                        const planItem = billingQuery.data?.planCatalog.find(
                          (item) => item.planTier === plan,
                        );
                        return (
                          <TableCell key={plan}>
                            {planItem ? planItem.limits.maxProducts : "-"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                    <TableRow>
                      <TableCell>{t("comparison.rows.users")}</TableCell>
                      {planOrder.map((plan) => {
                        const planItem = billingQuery.data?.planCatalog.find(
                          (item) => item.planTier === plan,
                        );
                        return (
                          <TableCell key={plan}>
                            {planItem ? planItem.limits.maxUsers : "-"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                    {comparisonFeatures.map((feature) => (
                      <TableRow key={feature}>
                        <TableCell>{t(`features.${feature}`)}</TableCell>
                        {planOrder.map((plan) => {
                          const planItem = billingQuery.data?.planCatalog.find(
                            (item) => item.planTier === plan,
                          );
                          const enabled = planItem
                            ? Boolean(planItem.featureFlags[feature])
                            : false;
                          return (
                            <TableCell key={`${feature}-${plan}`}>
                              {enabled ? (
                                <span className="inline-flex items-center gap-1 text-success">
                                  <CheckIcon className="h-3.5 w-3.5" aria-hidden />
                                  {t("comparison.included")}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-muted-foreground">
                                  <LockIcon className="h-3.5 w-3.5" aria-hidden />
                                  {t("comparison.locked")}
                                </span>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </details>
          </Card>

          <div
            className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
            data-billing-upgrade-cta
          >
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("payments.support")}</p>
              {billingQuery.data.subscriptionBillingMode === "MANUAL" &&
              !billingQuery.data.lifetimeAccess ? (
                <p className="text-xs text-muted-foreground">{t("ctaHint")}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild type="button" variant="secondary">
                <a href={t("ctaWhatsappLink")} target="_blank" rel="noreferrer">
                  {t("ctaWhatsapp")}
                </a>
              </Button>
              {billingQuery.data.subscriptionBillingMode === "SELF_SERVE" &&
              !billingQuery.data.lifetimeAccess &&
              billingQuery.data.subscriptionStatus !== "CANCELED" ? (
                <Button asChild>
                  <a href="#subscription-checkout">{t("payments.openCheckout")}</a>
                </Button>
              ) : billingQuery.data.subscriptionBillingMode === "MANUAL" &&
                !billingQuery.data.lifetimeAccess ? (
                <Button
                  type="button"
                  disabled={!currentPlan || currentPlan === "ENTERPRISE" || Boolean(pendingRequest)}
                  onClick={() => setRequestedPlan("ENTERPRISE")}
                >
                  {t("requestUpgrade")}
                </Button>
              ) : null}
            </div>
          </div>
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
              <label
                htmlFor="billing-upgrade-message"
                className="block text-sm font-medium text-foreground"
              >
                {t("requestMessageLabel")}
              </label>
              <Textarea
                id="billing-upgrade-message"
                value={requestMessage}
                onChange={(event) => setRequestMessage(event.target.value)}
                rows={4}
                placeholder={t("requestMessagePlaceholder")}
                maxLength={500}
              />
            </div>
            <ModalFooter>
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
            </ModalFooter>
          </form>
        ) : null}
      </Modal>
    </div>
  );
};

export default BillingPage;
