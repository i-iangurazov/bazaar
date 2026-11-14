import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSolutionsCopy } from "@/content/solutions";
import { solutionPresentation } from "@/content/solutions/presentation";
import { getMarketingCopy } from "@/content/marketing";
import { marketingCaptures } from "@/content/marketing/assets";
import { getHelpGuide } from "@/content/help/catalog";
import { localize } from "@/content/help/ui";
import { getPlanCatalogEntries } from "@/server/billing/planCatalog";
import { loadPublicSellerLegalName } from "@/server/legal/seller";
import { legalPublicationState } from "@/lib/legalPublication";
import { formatNumber } from "@/lib/i18nFormat";
import { TRIAL_DAYS } from "@/lib/billing/trial";
import { marketingHomePath, marketingSiteUrl } from "@/lib/marketingSeo";
import { marketingSolutionPath, solutionPages, type SolutionId } from "@/lib/marketingSolutions";
import {
  getMarketingStructuredData,
  serializeMarketingStructuredData,
} from "@/lib/marketingStructuredData";
import type { Locale } from "@/lib/locales";
import { MarketingNav } from "./MarketingNav";
import { MarketingLocaleSwitcher } from "./MarketingLocaleSwitcher";
import marketing from "./marketing.module.css";
import styles from "./solutions.module.css";

const supportEmail = "support@bazaar.kg";

export const SolutionsPage = async ({ locale, id }: { locale: Locale; id?: SolutionId }) => {
  const t = await getTranslations({ locale, namespace: "billing" });
  const copy = getSolutionsCopy(locale);
  const landing = getMarketingCopy(locale);
  const contentId = id ?? "retail";
  const page = copy.pages[contentId];
  const presentation = solutionPresentation[contentId];
  const home = marketingHomePath(locale);
  const hub = marketingSolutionPath(locale);
  const url = `${marketingSiteUrl}${marketingSolutionPath(locale, id)}`;
  const plans = getPlanCatalogEntries();
  const planName = (plan: (typeof plans)[number]) => t(`plans.${plan.code.toLowerCase()}.name`);
  const number = (value: number) => formatNumber(value, locale);
  const seller = loadPublicSellerLegalName();
  const publishedLegal = legalPublicationState().published;
  const identity = getMarketingStructuredData({
    locale,
    description: landing.meta.structuredDescription,
    offers: plans.map((plan) => ({ name: planName(plan), price: plan.monthlyPriceKgs })),
  });
  const breadcrumbs = [
    { name: copy.ui.home, item: `${marketingSiteUrl}${home}` },
    { name: copy.ui.solutions, item: `${marketingSiteUrl}${hub}` },
    ...(id ? [{ name: page.title, item: url }] : []),
  ];
  const structuredData = {
    ...identity,
    "@graph": [
      ...identity["@graph"],
      {
        "@type": id === "store-guide" ? "TechArticle" : id ? "WebPage" : "CollectionPage",
        "@id": `${url}#page`,
        url,
        name: page.title,
        ...(id === "store-guide"
          ? { headline: page.title, author: { "@id": `${marketingSiteUrl}/#organization` } }
          : {}),
        description: page.description,
        inLanguage: locale === "kg" ? "ky" : locale,
        isPartOf: { "@id": `${marketingSiteUrl}/#website` },
        about: { "@id": `${marketingSiteUrl}/#software` },
        publisher: { "@id": `${marketingSiteUrl}/#organization` },
        breadcrumb: { "@id": `${url}#breadcrumb` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: breadcrumbs.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          ...item,
        })),
      },
    ],
  };

  return (
    <main className={marketing.marketing} data-marketing-root data-solution-page={contentId}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeMarketingStructuredData(structuredData) }}
      />
      <MarketingNav
        copy={landing.nav}
        homeHref={home}
        landingHref={home}
        solutionsLink={{ href: hub, label: copy.ui.solutions }}
      />
      <nav className={styles.breadcrumbs} aria-label={copy.ui.breadcrumbLabel}>
        <Link href={home}>{copy.ui.home}</Link>
        <span aria-hidden="true">/</span>
        {id ? (
          <Link href={hub}>{copy.ui.solutions}</Link>
        ) : (
          <span aria-current="page">{copy.ui.solutions}</span>
        )}
        {id ? (
          <>
            <span className={styles.currentBreadcrumbSeparator} aria-hidden="true">
              /
            </span>
            <span aria-current="page">{page.title}</span>
          </>
        ) : null}
      </nav>

      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{page.eyebrow}</p>
          <h1>{page.title}</h1>
          <div className={styles.actions}>
            <Link className={styles.primaryCta} href="/signup">
              {copy.ui.primaryCta}
              <span aria-hidden="true">→</span>
            </Link>
            <Link className={styles.secondaryCta} href={`${home}#pricing`}>
              {copy.ui.pricingLink}
            </Link>
          </div>
          <p className={styles.lead}>{page.description}</p>
          <p className={styles.trial}>{t("trial.offer", { days: TRIAL_DAYS })}</p>
        </div>
        <figure className={styles.capture}>
          <Image
            src={marketingCaptures[presentation.capture]}
            width={1920}
            height={1080}
            alt={`${copy.ui.demoLabel}: ${page.title}`}
            sizes="(max-width: 800px) 100vw, 58vw"
            quality={85}
            priority
          />
          <figcaption>{copy.ui.demoLabel}</figcaption>
        </figure>
      </header>

      <div className={styles.body}>
        <p className={styles.introduction}>{page.intro}</p>

        {!id ? (
          <section className={styles.section} aria-labelledby="solutions-index-title">
            <h2 id="solutions-index-title">{copy.ui.indexTitle}</h2>
            <p>{copy.ui.indexIntro}</p>
            <nav className={styles.cards} aria-label={copy.ui.solutions}>
              {solutionPages.map((entry) => (
                <Link key={entry.id} href={marketingSolutionPath(locale, entry.id)}>
                  <h3>{copy.pages[entry.id].title}</h3>
                  <p>{copy.pages[entry.id].description}</p>
                  <span aria-hidden="true">↗</span>
                </Link>
              ))}
            </nav>
          </section>
        ) : null}

        {page.sections.map((section) => (
          <section key={section.title} className={styles.section}>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}

        <section className={styles.section} aria-labelledby="solution-workflow-title">
          <h2 id="solution-workflow-title">{copy.ui.workflowTitle}</h2>
          <ol className={styles.steps}>
            {page.workflow.map((step) => (
              <li key={step.title}>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.section} aria-labelledby="solution-guides-title">
          <h2 id="solution-guides-title">{copy.ui.guidesTitle}</h2>
          <ul className={styles.guideLinks}>
            {presentation.guides.map(({ category, slug }) => {
              const guide = getHelpGuide(category, slug);
              return guide ? (
                <li key={slug}>
                  <Link href={`/help/${category}/${slug}`}>
                    {localize(guide.title, locale)}
                    <span aria-hidden="true"> →</span>
                  </Link>
                </li>
              ) : null;
            })}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="solution-pricing-title">
          <h2 id="solution-pricing-title">{t("publicPricing.title")}</h2>
          <p>{copy.ui.planNote}</p>
          <div className={styles.planCards}>
            {plans.map((plan) => (
              <article key={plan.code} data-plan={plan.code}>
                <h3>{planName(plan)}</h3>
                <p className={styles.price}>
                  {t("planPricePrimary", { amount: number(plan.monthlyPriceKgs) })}
                  <small>{t("publicPricing.monthlySuffix")}</small>
                </p>
                <p>{t("publicPricing.includedStores", { count: number(plan.limits.maxStores) })}</p>
                <p>{t("capacityProducts", { limit: number(plan.limits.maxProducts) })}</p>
                <p>{t("capacityUsers", { limit: number(plan.limits.maxActiveUsers) })}</p>
                <Link href="/signup">
                  {copy.ui.primaryCta}
                  <span aria-hidden="true"> →</span>
                </Link>
              </article>
            ))}
          </div>
          <div
            className={styles.tableScroll}
            role="region"
            aria-label={t("comparisonTitle")}
            tabIndex={0}
          >
            <table>
              <caption>{t("comparisonTitle")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("comparison.columnFeature")}</th>
                  {plans.map((plan) => (
                    <th scope="col" key={plan.code}>
                      {planName(plan)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {presentation.features.map((feature) => (
                  <tr key={feature} data-feature={feature}>
                    <th scope="row">{t(`features.${feature}`)}</th>
                    {plans.map((plan) => (
                      <td key={plan.code} data-included={plan.features[feature]}>
                        {t(plan.features[feature] ? "comparison.included" : "comparison.locked")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link className={styles.textLink} href={`${home}#pricing`}>
            {copy.ui.pricingLink}
            <span aria-hidden="true"> →</span>
          </Link>
        </section>

        <section className={styles.section} aria-labelledby="solution-faq-title">
          <h2 id="solution-faq-title">{copy.ui.faqTitle}</h2>
          <div className={styles.faq}>
            {page.faq.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {id ? (
          <section className={styles.section} aria-labelledby="related-solutions-title">
            <h2 id="related-solutions-title">{copy.ui.relatedTitle}</h2>
            <nav className={styles.related} aria-label={copy.ui.relatedTitle}>
              {solutionPages
                .filter((entry) => entry.id !== id)
                .map((entry) => (
                  <Link key={entry.id} href={marketingSolutionPath(locale, entry.id)}>
                    {copy.pages[entry.id].title}
                    <span aria-hidden="true"> →</span>
                  </Link>
                ))}
              <Link href={hub}>
                {copy.ui.backToSolutions}
                <span aria-hidden="true"> →</span>
              </Link>
            </nav>
          </section>
        ) : null}
      </div>

      <footer className={styles.footer}>
        <Link href={home} className={styles.footerBrand} aria-label={landing.nav.home}>
          <Image src="/brand/logo.png" width={181} height={45} alt="BAZAAR" />
        </Link>
        <p>{landing.footer.description}</p>
        {seller ? (
          <p data-public-seller-identity>
            {landing.footer.owner}: {seller}
          </p>
        ) : null}
        <nav aria-label={landing.footer.company}>
          <Link href={hub}>{copy.ui.solutions}</Link>
          <Link href="/help">{landing.footer.help}</Link>
          <Link href="/privacy">{landing.footer.privacy}</Link>
          {publishedLegal ? <Link href="/legal/requisites">{landing.footer.legal}</Link> : null}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
          <a href="https://wa.me/996709911300">+996 709 911 300</a>
        </nav>
        <MarketingLocaleSwitcher />
      </footer>
    </main>
  );
};
