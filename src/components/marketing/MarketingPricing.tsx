import Link from "next/link";

import { PLAN_FEATURE_CODES } from "@/lib/billing/plans";
import { formatNumber } from "@/lib/i18nFormat";
import type { PlanDefinition } from "@/server/billing/planCatalog";
import styles from "./marketing.module.css";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export function MarketingPricing({
  plans,
  locale,
  t,
}: {
  plans: PlanDefinition[];
  locale: string;
  t: Translate;
}) {
  const name = (plan: PlanDefinition) => t(`plans.${plan.code.toLowerCase()}.name`);
  const number = (value: number) => formatNumber(value, locale, { maximumFractionDigits: 2 });
  const capacityRows = [
    ["stores", "maxStores"],
    ["products", "maxProducts"],
    ["users", "maxActiveUsers"],
  ] as const;

  return (
    <section id="pricing" className={styles.pricingSection}>
      <div className={styles.sectionHeading} data-reveal>
        <p className={styles.eyebrow}>
          <span>08</span>
          {t("title")}
        </p>
        <h2>{t("publicPricing.title")}</h2>
        <p>{t("publicPricing.description")}</p>
      </div>
      <div className={styles.planGrid}>
        {plans.map((plan, index) => {
          const previous = plans[index - 1];
          const highlights = PLAN_FEATURE_CODES.filter(
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
              <p>{t(`planDescriptions.${plan.code.toLowerCase()}`)}</p>
              <div className={styles.planPrice}>
                <b>{number(plan.monthlyPriceKgs)}</b>
                <span>{t("publicPricing.monthlySuffix")}</span>
              </div>
              <div className={styles.planCapacity}>
                <span>{t("capacityStores", { limit: number(plan.limits.maxStores) })}</span>
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
              {PLAN_FEATURE_CODES.map((feature) => (
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
    </section>
  );
}
