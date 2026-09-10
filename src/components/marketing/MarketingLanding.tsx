import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PLAN_CODES, getPlanLimits, getPlanMonthlyPriceKgs } from "@/server/billing/planCatalog";
import { toIntlLocale } from "@/lib/locales";
import { FeatureShowcase } from "./FeatureShowcase";
import { MarketingNav } from "./MarketingNav";
import { MarketingIcon } from "./MarketingIcon";
import { MobilePreview, ProductPreview } from "./ProductPreview";
import styles from "./marketing.module.css";

const whatsappUrl = "https://wa.me/996709911300";

export const MarketingLanding = async () => {
  const t = await getTranslations("marketing");
  const locale = await getLocale();
  const format = (value: number) =>
    new Intl.NumberFormat(toIntlLocale(locale), { maximumFractionDigits: 2 }).format(value);
  const configuredTrialDays = Number(process.env.TRIAL_DAYS ?? "14");
  const trialDays =
    Number.isFinite(configuredTrialDays) && configuredTrialDays > 0 ? configuredTrialDays : 14;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Bazaar",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, iOS, Android",
    description: t("meta.description"),
    url: "https://www.bazaar.kg/",
    offers: PLAN_CODES.map((code) => ({
      "@type": "Offer",
      name: t(`pricing.${code}.name`),
      price: String(getPlanMonthlyPriceKgs(code)),
      priceCurrency: "KGS",
    })),
  };
  return (
    <div className={styles.marketing} data-marketing-root>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <MarketingNav />
      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={`${styles.container} ${styles.heroGrid}`}>
            <div className={styles.heroCopy}>
              <p className={styles.heroKicker}>
                <span />
                {t("hero.eyebrow")}
              </p>
              <h1 id="hero-title">
                {t("hero.title")}
                <span>{t("hero.accent")}</span>
              </h1>
              <p className={styles.heroLead}>{t("hero.description")}</p>
              <div className={styles.heroActions}>
                <Link href="/signup" className={styles.primaryCta}>
                  {t("actions.try")}
                  <MarketingIcon />
                </Link>
                <a href="#platform" className={styles.secondaryCta}>
                  {t("actions.explore")}
                  <span>↘</span>
                </a>
              </div>
              <p className={styles.heroNote}>
                <MarketingIcon name="check" />
                {t("hero.note", { days: trialDays })}
              </p>
            </div>
            <div className={styles.heroVisual}>
              <ProductPreview />
              <div className={styles.heroVisualLabel}>
                <span>01 — BAZAAR</span>
                <span>{t("hero.visualLabel")}</span>
              </div>
            </div>
          </div>
          <div className={`${styles.container} ${styles.heroFooter}`}>
            <span>{t("hero.for")}</span>
            <div>
              {(t.raw("hero.businesses") as string[]).map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
        </section>

        <section
          className={`${styles.container} ${styles.connection}`}
          aria-labelledby="connection-title"
        >
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>{t("connection.eyebrow")}</p>
            <h2 id="connection-title">{t("connection.title")}</h2>
            <p>{t("connection.description")}</p>
          </div>
          <div className={styles.connectionSteps}>
            {(["sell", "stock", "understand"] as const).map((id, i) => (
              <article key={id}>
                <span className={styles.stepNumber}>0{i + 1}</span>
                <MarketingIcon name={(["receipt", "box", "chart"] as const)[i]} />
                <h3>{t(`connection.${id}.title`)}</h3>
                <p>{t(`connection.${id}.body`)}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          id="platform"
          tabIndex={-1}
          className={styles.platform}
          aria-labelledby="platform-title"
        >
          <div className={styles.container}>
            <div className={styles.platformHeading}>
              <div>
                <p className={styles.eyebrow}>{t("showcase.eyebrow")}</p>
                <h2 id="platform-title">{t("showcase.title")}</h2>
              </div>
              <p>{t("showcase.description")}</p>
            </div>
            <FeatureShowcase />
          </div>
        </section>

        <section
          id="workflows"
          tabIndex={-1}
          className={`${styles.container} ${styles.workflows}`}
          aria-labelledby="workflows-title"
        >
          <div className={styles.workflowsCopy}>
            <p className={styles.eyebrow}>{t("workflows.eyebrow")}</p>
            <h2 id="workflows-title">{t("workflows.title")}</h2>
            <p className={styles.sectionLead}>{t("workflows.description")}</p>
            <div className={styles.workflowList}>
              {(["stores", "team", "customers"] as const).map((id, i) => (
                <article key={id}>
                  <MarketingIcon name={(["store", "people", "receipt"] as const)[i]} />
                  <div>
                    <h3>{t(`workflows.${id}.title`)}</h3>
                    <p>{t(`workflows.${id}.body`)}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
          <div className={styles.mobileCard}>
            <div className={styles.mobileCopy}>
              <span className={styles.mobileBadge}>{t("mobile.eyebrow")}</span>
              <h2>{t("mobile.title")}</h2>
              <p>{t("mobile.description")}</p>
            </div>
            <MobilePreview />
            <p className={styles.mobileCaption}>{t("preview.caption")}</p>
          </div>
        </section>

        <section
          className={`${styles.container} ${styles.integrations}`}
          aria-labelledby="integrations-title"
        >
          <div>
            <p className={styles.eyebrow}>{t("integrations.eyebrow")}</p>
            <h2 id="integrations-title">{t("integrations.title")}</h2>
            <p>{t("integrations.description")}</p>
          </div>
          <div className={styles.integrationNames}>
            <span>M-Market</span>
            <span>Bakai Store</span>
            <span>O! Market</span>
            <Link href="/developers/bazaar-api">
              Bazaar API
              <MarketingIcon />
            </Link>
          </div>
        </section>

        <section
          id="pricing"
          tabIndex={-1}
          className={styles.pricing}
          aria-labelledby="pricing-title"
        >
          <div className={styles.container}>
            <div className={styles.pricingHeading}>
              <div>
                <p className={styles.eyebrow}>{t("pricing.eyebrow")}</p>
                <h2 id="pricing-title">{t("pricing.title")}</h2>
              </div>
              <p>{t("pricing.description", { days: trialDays })}</p>
            </div>
            <div className={styles.planGrid}>
              {PLAN_CODES.map((code) => {
                const limits = getPlanLimits(code);
                return (
                  <article
                    key={code}
                    className={`${styles.planCard} ${code === "BUSINESS" ? styles.planFeatured : ""}`}
                  >
                    <div className={styles.planName}>
                      <h3>{t(`pricing.${code}.name`)}</h3>
                      {code === "BUSINESS" && <span>{t("pricing.retail")}</span>}
                    </div>
                    <p>{t(`pricing.${code}.description`)}</p>
                    <div className={styles.planPrice}>
                      <strong>{format(getPlanMonthlyPriceKgs(code))}</strong>
                      <span>
                        {t("pricing.currency")}
                        <br />
                        {t("pricing.period")}
                      </span>
                    </div>
                    <div className={styles.planStores}>
                      <MarketingIcon name="store" />
                      <strong>{t("pricing.stores", { count: limits.maxStores })}</strong>
                    </div>
                    <ul>
                      {(t.raw(`pricing.${code}.features`) as string[]).map((feature) => (
                        <li key={feature}>
                          <MarketingIcon name="check" />
                          {feature}
                        </li>
                      ))}
                      <li>
                        <MarketingIcon name="check" />
                        {t("pricing.products", { count: format(limits.maxProducts) })}
                      </li>
                      <li>
                        <MarketingIcon name="check" />
                        {t("pricing.users", { count: limits.maxActiveUsers })}
                      </li>
                    </ul>
                    <Link
                      className={code === "BUSINESS" ? styles.primaryCta : styles.outlineCta}
                      href="/signup"
                    >
                      {t("actions.start")}
                      <MarketingIcon />
                    </Link>
                  </article>
                );
              })}
            </div>
            <p className={styles.pricingNote}>{t("pricing.note")}</p>
          </div>
        </section>

        <section
          id="faq"
          tabIndex={-1}
          className={`${styles.container} ${styles.faq}`}
          aria-labelledby="faq-title"
        >
          <div>
            <p className={styles.eyebrow}>{t("faq.eyebrow")}</p>
            <h2 id="faq-title">{t("faq.title")}</h2>
            <p>{t("faq.help")}</p>
            <a href={whatsappUrl} className={styles.textLink}>
              {t("actions.contact")}
              <MarketingIcon />
            </a>
          </div>
          <div className={styles.faqList}>
            {(["start", "import", "devices", "access"] as const).map((id) => (
              <details key={id}>
                <summary>
                  {t(`faq.${id}.question`)}
                  <MarketingIcon name="plus" />
                </summary>
                <p>{t(`faq.${id}.answer`)}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={`${styles.container} ${styles.finalCta}`} aria-labelledby="start-title">
          <div>
            <p className={styles.eyebrow}>{t("closing.eyebrow")}</p>
            <h2 id="start-title">{t("closing.title")}</h2>
            <p>{t("closing.description")}</p>
          </div>
          <div>
            <Link href="/signup" className={styles.primaryCta}>
              {t("actions.try")}
              <MarketingIcon />
            </Link>
            <span>{t("hero.note", { days: trialDays })}</span>
          </div>
        </section>
      </main>
      <footer className={`${styles.container} ${styles.footer}`}>
        <div className={styles.footerTop}>
          <div>
            <Link href="/" className={styles.brand} aria-label={t("nav.home")}>
              <Image src="/brand/icon.png" width={32} height={32} alt="" />
              <span>BAZAAR</span>
            </Link>
            <p>{t("footer.description")}</p>
          </div>
          <div className={styles.footerLinks}>
            <nav aria-label={t("footer.product")}>
              <h3>{t("footer.product")}</h3>
              <a href="#platform">{t("nav.platform")}</a>
              <a href="#pricing">{t("nav.pricing")}</a>
              <Link href="/developers/bazaar-api">Bazaar API</Link>
            </nav>
            <nav aria-label={t("footer.support")}>
              <h3>{t("footer.support")}</h3>
              <Link href="/help">{t("footer.help")}</Link>
              <a href={whatsappUrl}>
                WhatsApp
                <MarketingIcon />
              </a>
              <Link href="/login">{t("actions.login")}</Link>
            </nav>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <span>© {new Date().getFullYear()} Bazaar</span>
          <span>{t("footer.origin")}</span>
          <Link href="/privacy">{t("footer.privacy")}</Link>
        </div>
      </footer>
    </div>
  );
};
