"use client";

import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

const subscriptionFailureKeys = new Set([
  "billingUsageLimitReached",
  "billingUsageAlreadyCompleted",
  "billingUsageInProgress",
  "billingMarketplaceChannelInUse",
  "billingScheduledFeatureConflict",
  "featureLockedPlan",
  "subscriptionInactive",
]);

/** Local billing failures are not external provider/network errors. */
export function MarketplaceSubscriptionFailure({ report }: { report: unknown }) {
  const t = useTranslations("errors");
  const row =
    report && typeof report === "object" && !Array.isArray(report)
      ? (report as Record<string, unknown>)
      : null;
  const error =
    row?.error && typeof row.error === "object" && !Array.isArray(row.error)
      ? (row.error as Record<string, unknown>)
      : null;
  const key = typeof row?.reason === "string" ? row.reason : error?.message;
  if (typeof key !== "string" || !subscriptionFailureKeys.has(key) || !t.has(key)) return null;
  return (
    <p className="mt-2 text-sm text-destructive" role="status">
      {t(key)}
    </p>
  );
}

export function MarketplacePlanNotice() {
  const t = useTranslations("billing.marketplace");
  const query = trpc.billing.features.useQuery(undefined, { staleTime: 60_000, retry: false });
  if (!query.data || query.data.billingCatalogVersion !== "2026-11" || query.data.lifetimeAccess)
    return null;
  const live = query.data.featureFlags.marketplaces;
  const channel = query.data.selectedMarketplaceChannel;
  const labels: Record<string, string> = {
    MMARKET: "М-Маркет",
    BAKAI: "Bakai Store API",
    OMARKET: "О!Маркет",
  };
  return (
    <Card>
      <CardContent className="space-y-2 p-4 text-sm">
        <p>{t(live ? "included" : "fileOnly")}</p>
        {live && channel ? (
          <p className="font-medium">{t("selected", { channel: labels[channel] ?? channel })}</p>
        ) : null}
        {live ? <p className="text-muted-foreground">{t("switch")}</p> : null}
      </CardContent>
    </Card>
  );
}
