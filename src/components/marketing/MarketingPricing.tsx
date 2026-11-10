import Link from "next/link";
import { TRIAL_DAYS } from "@/lib/billing/trial";

import { PLAN_FEATURE_CODES } from "@/lib/billing/plans";
import { ADDITIONAL_STORE_CAPS, subscriptionPrice } from "@/lib/billing/subscriptionPricing";
import { formatNumber } from "@/lib/i18nFormat";
import type { BillingTranslator } from "@/lib/i18n/billingTranslator";
import type { PlanDefinition } from "@/server/billing/planCatalog";
import { SubscriptionAddons } from "@/components/billing/subscription-addons";
import styles from "./marketing.module.css";

const planMessageKeys = { STARTER: "starter", BUSINESS: "business", ENTERPRISE: "enterprise" } as const;

export function MarketingPricing({
  plans,
  locale,
  t,
}: {
  plans: PlanDefinition[];
  locale: string;
  t: BillingTranslator;
}) {
  const name = (plan: PlanDefinition) => t(`plans.${planMessageKeys[plan.code]}.name`);
  const number = (value: number) => formatNumber(value, locale, { maximumFractionDigits: 2 });
  const capacityRows = [
    ["stores", "maxStores"],
    ["products", "maxProducts"],
    ["users", "maxActiveUsers"],
  ] as const;
  const publicFeatures = PLAN_FEATURE_CODES.filter(feature =>
    !["supportToolkit", "compliance", "kkm"].includes(feature));

  return (
    <section id="pricing" className={styles.pricingSection}>
      <div className={styles.sectionHeading} data-reveal>
        <p className={styles.eyebrow}>
          <span>08</span>
          {t("title")}
        </p>
        <h2>{t("publicPricing.title")}</h2>
        <p>{t("publicPricing.description")}</p>
        <p>{t("trial.offer", { days: TRIAL_DAYS })}</p>
      </div>
      <div className={styles.planGrid}>
        {plans.map((plan, index) => {
          const previous = plans[index - 1];
          const highlights = publicFeatures.filter(
            (feature) => plan.features[feature] && !previous?.features[feature],
          ).slice(0, 3);
          const recommended = plan.code === "BUSINESS";
          return (
            <article
              key={plan.code}
              data-plan={plan.code}
              className={`${styles.planCard} ${recommended ? styles.planFeatured : ""}`}
              data-reveal
            >
              {recommended ? (
                <span className={styles.recommended}>{t("publicPricing.recommended")}</span>
              ) : null}
              <h3>{name(plan)}</h3>
              <p>{t(`planDescriptions.${planMessageKeys[plan.code]}`)}</p>
              <div className={styles.planPrice}>
                <b>{number(plan.monthlyPriceKgs)}</b>
                <span>{t("publicPricing.monthlySuffix")}</span>
              </div>
              <div className={styles.planCapacity}>
                <span>{t("publicPricing.includedStores", { count: number(plan.limits.maxStores) })}</span>
                <span className={styles.planExpansion} data-store-expansion>
                  {ADDITIONAL_STORE_CAPS[plan.code] > 0
                    ? t("publicPricing.expandStores", { count: number(plan.limits.maxStores + ADDITIONAL_STORE_CAPS[plan.code]) })
                    : t("publicPricing.singleStore")}
                </span>
                <span>{t("capacityProducts", { limit: number(plan.limits.maxProducts) })}</span>
                <span>{t("capacityUsers", { limit: number(plan.limits.maxActiveUsers) })}</span>
              </div>
              <ul>
                {previous ? (
                  <li>{t("publicPricing.includesPrevious", { plan: name(previous) })}</li>
                ) : null}
                {highlights.map((feature) => (
                  <li key={feature}>
                    <span aria-hidden="true">✓</span>
                    {t(`features.${feature}`)}
                  </li>
                ))}
              </ul>
              <Link href="/signup">
                {t("publicPricing.tryFree")} <span aria-hidden="true">→</span>
              </Link>
            </article>
          );
        })}
      </div>
      <details className={styles.planComparison}>
        <summary>
          {t("comparisonTitle")} <span aria-hidden="true">→</span>
        </summary>
        <div
          className={styles.planComparisonScroll}
          role="region"
          aria-label={t("comparisonTitle")}
          tabIndex={0}
        >
          <table>
            <caption className="sr-only">{t("comparisonTitle")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("comparison.columnFeature")}</th>
                {plans.map((plan) => (
                  <th scope="col" key={plan.code}>
                    {name(plan)}
                  </th>
                ))}
              </tr>
              {([6, 12] as const).map(months => <tr key={months}>
                <th scope="row">{t(months === 6 ? "publicPricing.halfYearTotal" : "publicPricing.yearTotal")}</th>
                {plans.map(plan => <td key={plan.code}>
                  {t("publicPricing.periodPrice", { amount: number(subscriptionPrice(plan.monthlyPriceKgs * 100, months).amountMinor / 100) })}
                </td>)}
              </tr>)}
            </thead>
            <tbody>
              <tr>
                <th scope="row">{t("publicPricing.monthlyPrice")}</th>
                {plans.map((plan) => (
                  <td key={plan.code}>
                    {t("planPricePrimary", { amount: number(plan.monthlyPriceKgs) })}
                  </td>
                ))}
              </tr>
              {capacityRows.map(([label, key]) => (
                <tr key={key}>
                  <th scope="row">{t(`comparison.rows.${label}`)}</th>
                  {plans.map((plan) => (
                    <td key={plan.code}>{number(plan.limits[key])}</td>
                  ))}
                </tr>
              ))}
              <tr><th scope="row">{t("publicPricing.maxStores")}</th>
                {plans.map(plan => <td key={plan.code}>{number(1 + ADDITIONAL_STORE_CAPS[plan.code])}</td>)}
              </tr>
              {(["ai", "images", "marketingEmails", "externalApi"] as const).map(resource =>
                <tr key={resource}><th scope="row">{t(`publicPricing.${resource}`)}</th>
                  {plans.map(plan => <td key={plan.code}>{number(plan.usageLimits[resource] ?? 0)}</td>)}
                </tr>)}
              {publicFeatures.map((feature) => (
                <tr key={feature} data-feature={feature}>
                  <th scope="row">{t(`features.${feature}`)}</th>
                  {plans.map((plan) => (
                    <td key={plan.code} data-included={String(plan.features[feature])}>
                      {t(plan.features[feature] ? "comparison.included" : "comparison.locked")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <SubscriptionAddons t={t} locale={locale} className={styles.pricingAddons}
        manageHref="/billing#subscription-addons" />
    </section>
  );
}
