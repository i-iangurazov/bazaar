"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import type { PlanCode, PlanFeature } from "@/lib/billing/plans";
import { LockIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { featureLockError } from "@/lib/billing/featureLocks";

export type FeaturePlanAvailability = Partial<Record<PlanFeature, PlanCode[]>>;

/** Keep locked secondary actions discoverable without filling a work table with upsells. */
export function SubscriptionFeatureAvailability({ features, flags, featurePlans, currentPlan, canManage, isTrial = false }: {
  features: PlanFeature[];
  flags: Partial<Record<PlanFeature, boolean>>;
  featurePlans?: FeaturePlanAvailability;
  currentPlan?: string | null;
  canManage: boolean;
  isTrial?: boolean;
}) {
  const t = useTranslations("billing");
  const missing = features.filter(feature => flags[feature] === false);
  if (!missing.length) return null;
  return <Card className="my-4" data-subscription-feature-availability>
    <CardContent className="p-4">
      <details>
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          {t("featureLock.moreFeatures", { count: missing.length })}
        </summary>
        <div className="mt-4 space-y-4">
          {missing.map(feature => <SubscriptionFeatureLock key={feature} feature={feature} compact
            availablePlans={featurePlans?.[feature]} currentPlan={currentPlan} canManage={canManage} isTrial={isTrial} />)}
        </div>
      </details>
    </CardContent>
  </Card>;
}

/** Shared presentation for a tariff restriction, never a replacement for authorization. */
export function SubscriptionFeatureLock({
  feature, canManage, currentPlan, availablePlans, compact = false, isTrial = false, restrictionMessage,
}: {
  feature?: PlanFeature | null;
  canManage: boolean;
  currentPlan?: string | null;
  availablePlans?: PlanCode[];
  compact?: boolean;
  isTrial?: boolean;
  restrictionMessage?: string;
}) {
  const t = useTranslations("billing");
  const title = feature ? t(`features.${feature}`) : t("featureLock.genericFeature");
  const plans = availablePlans?.map((plan) => t(`plans.${plan.toLowerCase()}.name`)).join(", ");
  const description = restrictionMessage ?? (isTrial ? t("featureLock.unavailableInTrial", { feature: title }) : currentPlan
    ? t("featureLock.unavailableOnPlan", { feature: title, plan: t(`plans.${currentPlan.toLowerCase()}.name`) })
    : t("featureLock.unavailable", { feature: title }));
  const body = (
    <div className={compact ? "flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" : "space-y-3"}>
      <div className="min-w-0 space-y-1">
        <p className="flex items-start gap-2 text-sm font-medium text-foreground">
          <LockIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{description}</span>
        </p>
        {plans ? <p className="text-sm text-muted-foreground">{t("featureLock.availableIn", { plans })}</p> : null}
        {availablePlans?.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("featureLock.notOffered")}</p>
        ) : !canManage ? <p className="text-sm text-muted-foreground">{t("featureAskOwner")}</p> : null}
      </div>
      {canManage ? (
        <Button asChild variant="secondary" className="min-h-10 w-full shrink-0 sm:w-auto">
          <Link href="/billing#plans">{t("viewPlans")}</Link>
        </Button>
      ) : null}
    </div>
  );
  return compact ? <div data-subscription-feature-lock={feature ?? "generic"}>{body}</div> : (
    <Card data-subscription-feature-lock={feature ?? "generic"}>
      <CardContent className="p-4 sm:p-6">{body}</CardContent>
    </Card>
  );
}

/** A failed request may race a plan change; recover using the current terms. */
export function SubscriptionFeatureError({ message, feature: errorFeature }: { message: string; feature?: PlanFeature | null }) {
  const { data: session } = useSession();
  const errors = useTranslations("errors");
  const query = trpc.billing.features.useQuery(undefined, { enabled: Boolean(session), staleTime: 30_000, retry: false });
  const failure = featureLockError(message);
  const feature = errorFeature ?? failure?.feature;
  return <SubscriptionFeatureLock feature={feature} canManage={session?.user?.role === "ADMIN"}
    restrictionMessage={failure?.key === "billingScheduledFeatureRestriction" || failure?.key === "whatsappPlanRequired"
      ? errors(failure.key) : undefined}
    currentPlan={query.data?.plan}
    isTrial={Boolean(query.data?.trialOffer)}
    availablePlans={feature ? query.data?.featurePlans?.[feature] : undefined} />;
}

/** Existing toast actions use this only for recognized tariff failures. */
export function SubscriptionFeatureToastAction() {
  const { data: session } = useSession();
  const t = useTranslations("billing");
  const query = trpc.billing.features.useQuery(undefined, { enabled: Boolean(session), staleTime: 30_000, retry: false });
  return <>
    {query.data?.trialOffer ? <p className="es-toast__description">{t("plans.trial")}</p>
      : query.data?.plan ? <p className="es-toast__description">{t("featureLock.currentPlan", {
        plan: t(`plans.${query.data.plan.toLowerCase()}.name`),
      })}</p> : null}
    {session?.user?.role === "ADMIN" ? (
      <Link className="es-toast__action button-focus-ring inline-flex max-w-full whitespace-normal text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href="/billing#plans">{t("viewPlans")}</Link>
    ) : <p className="es-toast__description">{t("featureAskOwner")}</p>}
  </>;
}
