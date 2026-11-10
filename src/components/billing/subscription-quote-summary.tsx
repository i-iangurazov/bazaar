"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { useLocale, useTranslations } from "next-intl";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { CheckIcon } from "@/components/icons";
import { PLAN_FEATURE_CODES, toPlanCode } from "@/lib/billing/plans";
import { CURRENT_CATALOG_VERSION } from "@/lib/billing/subscriptionPricing";
import { formatCurrencyKGS, formatDateTime } from "@/lib/i18nFormat";
import { cn } from "@/lib/utils";

export type SubscriptionQuote = inferRouterOutputs<AppRouter>["billing"]["payments"]["quote"];

/** Presentation uses the server's signed calculation; it never prices access. */
export function SubscriptionQuoteSummary({
  quote,
  className,
}: {
  quote: SubscriptionQuote;
  className?: string;
}) {
  const t = useTranslations("billing.payments");
  const billing = useTranslations("billing");
  const locale = useLocale();
  const money = (minor: number) => formatCurrencyKGS(minor / 100, locale);
  const enabled = PLAN_FEATURE_CODES.filter((feature) => quote.entitlements.features[feature]);
  return (
    <section
      aria-label={t("configuration")}
      aria-live="polite"
      data-subscription-quote
      className={cn("space-y-3 rounded-md border border-input p-4", className)}
    >
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t("plan")}</dt>
          <dd className="font-medium">
            {billing(`plans.${toPlanCode(quote.plan).toLowerCase()}.name`)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("term")}</dt>
          <dd>{t(`term${quote.months}`)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">{t("period")}</dt>
          <dd>
            {formatDateTime(quote.startsAt, locale)} — {formatDateTime(quote.endsAt, locale)}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">{t("extrasTitle")}</dt>
          <dd>
            {t("extrasSummary", {
              stores: quote.extras.stores,
              products: quote.extras.productPacks * 1000,
              users:
                quote.catalogVersion === CURRENT_CATALOG_VERSION
                  ? quote.extras.productPacks * 2
                  : quote.extras.userPacks * 5,
            })}
          </dd>
        </div>
      </dl>
      <p className="text-sm" data-subscription-selected-limits>
        {t("limitsSummary", {
          stores: quote.entitlements.limits.maxStores,
          products: quote.entitlements.limits.maxProducts,
          users: quote.entitlements.limits.maxActiveUsers,
        })}
      </p>
      <div className="space-y-1 border-t border-border pt-3 text-sm">
        {quote.kind === "UPGRADE" ? (
          <>
            <p>{t("serviceValue", { amount: money(quote.serviceValueMinor) })}</p>
            <p>{t("credit", { amount: money(quote.creditMinor) })}</p>
          </>
        ) : null}
        {quote.savingsMinor > 0 ? (
          <>
            <p className="text-muted-foreground">
              {t("fullPrice", { amount: money(quote.fullAmountMinor) })}
            </p>
            <p className="text-success" data-subscription-savings>
              {t("savings", {
                amount: money(quote.savingsMinor),
                percent: quote.discountBps / 100,
              })}
            </p>
          </>
        ) : null}
        {quote.kind === "UPGRADE" ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("termReference", { months: quote.months, amount: money(quote.termAmountMinor) })}
          </p>
        ) : null}
        <p className="pt-1 text-lg font-semibold text-foreground" data-subscription-amount-due>
          {t("total", { amount: money(quote.amountMinor) })}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        {quote.kind === "UPGRADE"
          ? t("upgradeDates", {
              start: formatDateTime(quote.startsAt, locale),
              end: formatDateTime(quote.endsAt, locale),
            })
          : t(
              quote.effectiveTiming === "AFTER_TRIAL"
                ? "timingAfterTrial"
                : quote.effectiveTiming === "NEXT_PERIOD"
                  ? "timingNextPeriod"
                  : "timingImmediate",
            )}
      </p>
      {quote.scheduledReduction ? (
        <p className="rounded-md bg-secondary p-3 text-sm">{t("scheduledReduction")}</p>
      ) : null}
      <details className="text-sm" data-subscription-selected-features>
        <summary className="cursor-pointer font-medium">{t("featuresTitle")}</summary>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {enabled.map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
              <span>{billing(`features.${feature}`)}</span>
            </li>
          ))}
        </ul>
      </details>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("monthlyQuotas")}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("oneTimePayment")}</p>
    </section>
  );
}
