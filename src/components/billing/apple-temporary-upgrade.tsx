"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { useLocale, useTranslations } from "next-intl";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { formatCurrencyKGS, formatDateTime } from "@/lib/i18nFormat";

type AppleOutputs = inferRouterOutputs<AppRouter>["billing"]["apple"];
export type TemporaryUpgradePreview = AppleOutputs["previewTemporaryUpgrade"];
type TemporaryUpgrades = AppleOutputs["catalog"]["temporaryUpgrades"];

export function AppleTemporaryUpgradeDetails({ quote, displayPrice }: { quote: TemporaryUpgradePreview; displayPrice?: string }) {
  const t = useTranslations("billingApple");
  const plans = useTranslations("billing.plans");
  const locale = useLocale();
  const selection = (value: Pick<TemporaryUpgradePreview["selection"], "plan" | "extras">) => t("currentSelection", {
    plan: plans(`${value.plan.toLowerCase()}.name`), stores: value.extras.stores, reserve: value.extras.productPacks,
  });
  return (
    <div className="space-y-2 text-sm" data-apple-temporary-details>
      <p className="font-medium">{t("temporaryTitle")}</p>
      <p>{t("temporaryBase", { provider: t(`temporaryProviders.${quote.source.provider}`) })}</p>
      <p>{selection({ plan: quote.source.plan, extras: quote.source.extras })}</p>
      <p>{t("temporaryBasePeriod", { start: formatDateTime(quote.source.startsAt, locale), end: formatDateTime(quote.source.endsAt, locale) })}</p>
      <p>{t("temporaryTarget")}</p>
      <p className="font-medium">{selection(quote.target.selection)}</p>
      <p>{t("period", { start: formatDateTime(quote.timing.startsAt, locale), end: formatDateTime(quote.timing.endsAt, locale) })}</p>
      <p>{t("temporaryPreserved")}</p>
      <p>{t("temporaryDependency")}</p>
      {quote.roundingMode === "UP_TO_COVER_QUOTE" && displayPrice ? (
        <div className="space-y-2" data-apple-upward-rounding>
          <p className="font-medium" data-apple-minimum-charge={quote.minimumChargeApplied ? "" : undefined}>
            {t(quote.minimumChargeApplied ? "temporaryUpwardMinimum" : "temporaryUpwardPrice", { price: displayPrice })}
          </p>
          {quote.serviceValue.upwardRoundingAdjustmentMinor > 0 ? (
            <p data-apple-upward-adjustment>{t("temporaryUpwardAdjustment", {
              amount: formatCurrencyKGS(quote.serviceValue.upwardRoundingAdjustmentMinor / 100, locale),
            })}</p>
          ) : null}
        </div>
      ) : quote.minimumChargeApplied && displayPrice ? (
        <p className="font-medium" data-apple-minimum-charge>{t("temporaryMinimumCharge", { price: displayPrice })}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("temporaryPriceTerms")}</p>
    </div>
  );
}

export function AppleTemporaryUpgradeHistory({ upgrades }: { upgrades: TemporaryUpgrades }) {
  const t = useTranslations("billingApple");
  const plans = useTranslations("billing.plans");
  const errors = useTranslations("errors");
  const locale = useLocale();
  if (!upgrades.length) return null;
  return (
    <div className="space-y-3 rounded-md border border-border p-3 text-sm" data-apple-temporary-history>
      <p className="font-medium">{t("temporaryHistory")}</p>
      {upgrades.map((upgrade) => (
        <div key={upgrade.id} className="space-y-1 border-t border-border pt-2">
          <p>{t(`temporaryStatuses.${upgrade.status}`)}</p>
          <p>{upgrade.extras ? t("currentSelection", {
            plan: plans(`${upgrade.plan.toLowerCase()}.name`), stores: upgrade.extras.stores, reserve: upgrade.extras.productPacks,
          }) : plans(`${upgrade.plan.toLowerCase()}.name`)}</p>
          <p>{t("period", { start: formatDateTime(upgrade.startsAt, locale), end: formatDateTime(upgrade.endsAt, locale) })}</p>
          {upgrade.requiresReview ? <p role="status">{upgrade.reason && errors.has(upgrade.reason) ? errors(upgrade.reason) : t("review")}</p> : null}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">{t("temporaryDependency")}</p>
      <p className="text-xs text-muted-foreground">{t("temporaryPreserved")}</p>
    </div>
  );
}
