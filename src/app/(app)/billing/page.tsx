"use client";

import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Lock } from "lucide-react";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
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
import { formatDateTime } from "@/lib/i18nFormat";
import { translateError } from "@/lib/translateError";

type PlanTier = "STARTER" | "BUSINESS" | "ENTERPRISE";
type PlanFeature =
  | "imports"
  | "exports"
  | "analytics"
  | "compliance"
  | "supportToolkit"
  | "pos"
  | "stockCounts"
  | "priceTags"
  | "storePrices"
  | "bundles"
  | "expiryLots"
  | "customerOrders"
  | "periodClose"
  | "kkm";

const planRank: Record<PlanTier, number> = {
  STARTER: 1,
  BUSINESS: 2,
  ENTERPRISE: 3,
};

const planOrder: PlanTier[] = ["STARTER", "BUSINESS", "ENTERPRISE"];

const featureOrder: PlanFeature[] = [
  "imports",
  "exports",
  "analytics",
  "compliance",
  "supportToolkit",
  "pos",
  "stockCounts",
  "priceTags",
  "storePrices",
  "bundles",
  "expiryLots",
  "customerOrders",
  "periodClose",
  "kkm",
];

const comparisonFeatures: PlanFeature[] = [
  "imports",
  "exports",
  "analytics",
  "pos",
  "stockCounts",
  "storePrices",
  "bundles",
  "expiryLots",
  "periodClose",
  "compliance",
  "supportToolkit",
  "kkm",
];

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
    return t(`plans.${requestedPlan.toLowerCase()}.name`);
  }, [requestedPlan, t]);

  const formatNumber = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);

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
          {billingQuery.data.limitState === "LIMIT_EXCEEDED" ? (
            <Card className="border-warning/40 bg-warning/10">
              <CardHeader>
                <CardTitle className="text-base">{t("limitExceededTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-foreground">
                <p>{t("limitExceededDescription")}</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {billingQuery.data.limitExceeded.stores ? <li>• {t("limitExceededItems.stores")}</li> : null}
                  {billingQuery.data.limitExceeded.products ? <li>• {t("limitExceededItems.products")}</li> : null}
                  {billingQuery.data.limitExceeded.users ? <li>• {t("limitExceededItems.users")}</li> : null}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t("planTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Badge variant={planBadgeVariant[billingQuery.data.planTier]}>
                  {t(`plans.${billingQuery.data.planTier.toLowerCase()}.name`)}
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
                      plan: t(`plans.${String(pendingRequest.requestedPlan).toLowerCase()}.name`),
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
              <div>
                <p>
                  {t("planPricePrimary", {
                    amount: formatNumber(billingQuery.data.monthlyPriceKgs),
                  })}
                </p>
              </div>
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
                          {t(`plans.${tier.toLowerCase()}.name`)}
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
                      <div>
                        <p className="text-base font-semibold text-foreground">
                          {t("planPricePrimary", {
                            amount: formatNumber(planItem.monthlyPriceKgs),
                          })}
                        </p>
                      </div>
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
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t("includesTitle")}
                        </p>
                        <ul className="space-y-1 text-xs">
                          {featureOrder.map((feature) => {
                            const enabled = Boolean(planItem.featureFlags[feature]);
                            return (
                              <li key={feature} className="flex items-center gap-2">
                                {enabled ? (
                                  <Check className="h-3.5 w-3.5 text-success" aria-hidden />
                                ) : (
                                  <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                                )}
                                <span className={enabled ? "text-foreground" : "text-muted-foreground"}>
                                  {t(`features.${feature}`)}
                                </span>
                              </li>
                            );
                          })}
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

          <Card>
            <CardHeader>
              <CardTitle>{t("comparisonTitle")}</CardTitle>
            </CardHeader>
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
                      const planItem = billingQuery.data?.planCatalog.find((item) => item.planTier === plan);
                      return <TableCell key={plan}>{planItem ? planItem.limits.maxStores : "-"}</TableCell>;
                    })}
                  </TableRow>
                  <TableRow>
                    <TableCell>{t("comparison.rows.products")}</TableCell>
                    {planOrder.map((plan) => {
                      const planItem = billingQuery.data?.planCatalog.find((item) => item.planTier === plan);
                      return <TableCell key={plan}>{planItem ? planItem.limits.maxProducts : "-"}</TableCell>;
                    })}
                  </TableRow>
                  <TableRow>
                    <TableCell>{t("comparison.rows.users")}</TableCell>
                    {planOrder.map((plan) => {
                      const planItem = billingQuery.data?.planCatalog.find((item) => item.planTier === plan);
                      return <TableCell key={plan}>{planItem ? planItem.limits.maxUsers : "-"}</TableCell>;
                    })}
                  </TableRow>
                  {comparisonFeatures.map((feature) => (
                    <TableRow key={feature}>
                      <TableCell>{t(`features.${feature}`)}</TableCell>
                      {planOrder.map((plan) => {
                        const planItem = billingQuery.data?.planCatalog.find((item) => item.planTier === plan);
                        const enabled = planItem ? Boolean(planItem.featureFlags[feature]) : false;
                        return (
                          <TableCell key={`${feature}-${plan}`}>
                            {enabled ? (
                              <span className="inline-flex items-center gap-1 text-success">
                                <Check className="h-3.5 w-3.5" aria-hidden />
                                {t("comparison.included")}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <Lock className="h-3.5 w-3.5" aria-hidden />
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
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("ctaTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>{t("ctaHint")}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  asChild
                  type="button"
                  variant="secondary"
                >
                  <a href={t("ctaWhatsappLink")} target="_blank" rel="noreferrer">
                    {t("ctaWhatsapp")}
                  </a>
                </Button>
                <Button
                  type="button"
                  disabled={!currentPlan || currentPlan === "ENTERPRISE" || Boolean(pendingRequest)}
                  onClick={() => setRequestedPlan("ENTERPRISE")}
                >
                  {t("requestUpgrade")}
                </Button>
              </div>
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
