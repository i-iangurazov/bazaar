"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CURRENT_CATALOG_VERSION } from "@/lib/billing/subscriptionPricing";
import { formatDateTime } from "@/lib/i18nFormat";
import { trpc } from "@/lib/trpc";

type AccessNoticeState = {
  billingCatalogVersion: string;
  lifetimeAccess: boolean;
  subscriptionStatus: string;
  access: { inGrace: boolean; hasAccess: boolean; graceEndsAt: Date | string | null };
};

export function SubscriptionAccessNotice({
  state,
  canManage,
  showBillingLink = true,
  className,
}: {
  state: AccessNoticeState | null | undefined;
  canManage: boolean;
  showBillingLink?: boolean;
  className?: string;
}) {
  const t = useTranslations("billing.accessNotice");
  const locale = useLocale();
  if (
    !state ||
    state.billingCatalogVersion !== CURRENT_CATALOG_VERSION ||
    state.lifetimeAccess ||
    state.subscriptionStatus === "CANCELED"
  )
    return null;
  const grace =
    state.access.inGrace &&
    state.access.graceEndsAt &&
    Number.isFinite(new Date(state.access.graceEndsAt).getTime());
  if (!grace && state.access.hasAccess) return null;
  return (
    <Alert
      variant={grace ? "warning" : "info"}
      className={className}
      data-subscription-access-notice={grace ? "grace" : "read-only"}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <AlertTitle>{t(grace ? "graceTitle" : "expiredTitle")}</AlertTitle>
          <AlertDescription>
            {grace
              ? t("graceDescription", { date: formatDateTime(state.access.graceEndsAt!, locale) })
              : t("expiredDescription")}
          </AlertDescription>
          {!canManage ? <p className="text-sm">{t("askOwner")}</p> : null}
        </div>
        {canManage && showBillingLink ? (
          <Button asChild variant="secondary" className="min-h-11 w-full shrink-0 sm:w-auto">
            <Link href="/billing">{t("renew")}</Link>
          </Button>
        ) : null}
      </div>
    </Alert>
  );
}

export function SubscriptionAccessBanner({ canManage }: { canManage: boolean }) {
  const onBilling = usePathname() === "/billing";
  const query = trpc.billing.features.useQuery(undefined, {
    enabled: !onBilling,
    staleTime: 60_000,
    retry: false,
    refetchInterval: (data) =>
      data?.billingCatalogVersion === CURRENT_CATALOG_VERSION &&
      !data.lifetimeAccess &&
      data.subscriptionStatus !== "CANCELED"
        ? 60_000
        : false,
  });
  // Loading/outage must never replace the current workspace or infer paid state.
  if (onBilling || query.isLoading || query.isError) return null;
  return <SubscriptionAccessNotice state={query.data} canManage={canManage} className="mb-6" />;
}
