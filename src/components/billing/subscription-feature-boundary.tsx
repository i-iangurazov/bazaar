"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { requiredPageFeature } from "@/lib/billing/pageFeatures";
import { PageHeader } from "@/components/page-header";
import { QueryErrorState } from "@/components/query-error-state";
import { SubscriptionFeatureLock } from "./subscription-feature-lock";

export function SubscriptionFeatureBoundary({
  children,
  canManage,
}: {
  children: ReactNode;
  canManage: boolean;
}) {
  const t = useTranslations("billing");
  const common = useTranslations("common");
  const feature = requiredPageFeature(usePathname() ?? "/");
  const billing = trpc.billing.features.useQuery(undefined, {
    enabled: feature !== null,
    staleTime: 60_000,
    retry: false,
    refetchInterval: 60_000,
  });
  if (!feature) return children;
  if (billing.isLoading)
    return (
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {common("loading")}
      </p>
    );
  if (billing.isError)
    return <QueryErrorState error={billing.error} onRetry={() => void billing.refetch()} />;
  if (billing.data?.featureFlags[feature]) return children;
  return (
    <div className="space-y-5">
      <PageHeader title={t(`features.${feature}`)} subtitle={t("featureRequiresPlan")} />
      <SubscriptionFeatureLock feature={feature} canManage={canManage}
        currentPlan={billing.data?.plan} availablePlans={billing.data?.featurePlans?.[feature]}
        isTrial={Boolean(billing.data?.trialOffer)} />
    </div>
  );
}
