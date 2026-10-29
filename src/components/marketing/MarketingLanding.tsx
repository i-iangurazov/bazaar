import Image from "next/image";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { getMarketingCopy, type MarketingCopy } from "@/content/marketing";
import { formatCurrency } from "@/lib/i18nFormat";
import { MarketingLocaleSwitcher } from "./MarketingLocaleSwitcher";
import { getPlanCatalogEntries } from "@/server/billing/planCatalog";
import { MarketingPricing } from "./MarketingPricing";

import { FeatureShowcase } from "./FeatureShowcase";
import { MarketingMotion } from "./MarketingMotion";
import { MarketingNav } from "./MarketingNav";
import { MarketingPreview } from "./MarketingPreview";
import { getMarketingPreviewData } from "@/content/marketing/preview";
import { PosIcon, InventoryIcon, ReportsIcon } from "@/components/icons";
import styles from "./marketing.module.css";

const whatsappUrl = "https://wa.me/996709911300";

const Arrow = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M3 8h9M9 4.5 12.5 8 9 11.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Check = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="m3 8.25 3.15 3L13 4.75"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Story = ({
  id,
  number,
  eyebrow,
  title,
  description,
  bullets,
  visual,
  reverse = false,
  dark = false,
}: {
  id: string;
  number: string;
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
  visual: ReactNode;
  reverse?: boolean;
  dark?: boolean;
}) => (
  <section id={id} className={`${styles.story} ${dark ? styles.storyDark : ""}`}>
    <div className={`${styles.storyGrid} ${reverse ? styles.storyReverse : ""}`}>
      <div className={styles.storyCopy} data-reveal>
        <p className={styles.eyebrow}>
          <span>{number}</span>
          {eyebrow}
        </p>
        <h2>{title}</h2>
        <p className={styles.storyDescription}>{description}</p>
        <ul className={styles.checkList}>
          {bullets.map((bullet) => (
            <li key={bullet}>
              <Check />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.storyVisual} data-reveal>
        {visual}
      </div>
    </div>
  </section>
);

const IntegrationFlow = ({ copy }: { copy: MarketingCopy }) => {
  const channels = [
    { mark: "API", label: "Bazaar API", data: copy.commerce.catalogOrders },
    { mark: "M", label: "M-Market", data: copy.commerce.catalogPrices },
    { mark: "B", label: "Bakai Store", data: copy.commerce.catalogPrices },
    { mark: "O!", label: "O! Market", data: copy.commerce.catalogOrders },
    { mark: "@", label: "Email Marketing", data: copy.commerce.customersCampaigns },
  ];
  return (
    <div className={styles.integrationConsole} aria-label={copy.commerce.label}>
      <div className={styles.integrationConsoleHeader}>
        <div className={styles.integrationIdentity}>
          <Image src="/brand/icon.png" width={42} height={42} alt="" />
          <p>
            <strong>{copy.commerce.title}</strong>
            <span>{copy.commerce.subtitle}</span>
          </p>
        </div>
        <span className={styles.liveStatus}>
          <i aria-hidden="true" />
          {copy.commerce.demo}
        </span>
      </div>
      <div className={styles.integrationPipeline} aria-hidden="true">
        {copy.commerce.pipeline.map((label, index) => (
          <Fragment key={label}>
            {index ? <b>→</b> : null}
            <span>{label}</span>
          </Fragment>
        ))}
      </div>
      <div className={styles.integrationChannels}>
        {channels.map((channel) => (
          <div className={styles.integrationChannel} key={channel.label}>
            <b>{channel.mark}</b>
            <p>
              <strong>{channel.label}</strong>
              <span>{channel.data}</span>
            </p>
            <small>
              <i aria-hidden="true" />
              {copy.commerce.status}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
};

export const MarketingLanding = async () => {
  const [t, locale] = await Promise.all([getTranslations("billing"), getLocale()]);
  const plans = getPlanCatalogEntries();
  const copy = getMarketingCopy(locale);
  const previewData = getMarketingPreviewData(locale);
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Bazaar",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, iOS PWA, Android PWA",
    description: copy.meta.structuredDescription,
    inLanguage: locale === "kg" ? "ky" : locale,
    url: "https://www.bazaar.kg/",
    offers: plans.map((plan) => ({
      "@type": "Offer",
      name: t(`plans.${plan.code.toLowerCase()}.name`),
      price: String(plan.monthlyPriceKgs),
      priceCurrency: "KGS",
    })),
  };
  return (
    <main className={styles.marketing} data-marketing-root>
      <MarketingMotion />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <MarketingNav copy={copy.nav} />

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <p className={styles.heroKicker}>
              <span />
              {copy.hero.kicker}
            </p>
            <h1 id="hero-title">
              {copy.hero.titleStart} <span>{copy.hero.titleEnd}</span>
            </h1>
            <p className={styles.heroLead}>{copy.hero.lead}</p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryCta} href="/signup">
                {copy.nav.start}
                <Arrow />
              </Link>
              <a className={styles.secondaryCta} href="#platform">
                {copy.hero.view}
              </a>
            </div>
            <p className={styles.heroNote}>{copy.hero.note}</p>
          </div>

          <div className={styles.heroVisual}>
            <div className={styles.heroPreviewLabel}>
              <span />
              {copy.hero.demo}
            </div>
            <MarketingPreview copy={copy.preview} data={previewData} />
            <div className={styles.heroCaption}>
              <Check />
              <span>{copy.hero.demoHint}</span>
            </div>
          </div>
        </div>
        <div className={styles.heroSystems} aria-label={copy.hero.systemsLabel}>
          {copy.hero.systems.map((system) => (
            <span key={system}>{system}</span>
          ))}
        </div>
      </section>

      <div className={styles.benefitStrip} aria-label={copy.benefits.label}>
        {copy.benefits.items.map((item, index) => {
          const Icon = [PosIcon, InventoryIcon, ReportsIcon][index];
          return (
            <a href={item.href} key={item.href}>
              <span className={styles.benefitIcon}>
                <Icon size={23} aria-hidden="true" />
              </span>
              <div>
                <h2>{item.title}</h2>
                <p>{item.body}</p>
              </div>
              <Arrow />
            </a>
          );
        })}
      </div>

      <section id="platform" className={styles.platformIntro}>
        <div className={styles.sectionHeading} data-reveal>
          <p className={styles.eyebrow}>
            <span>01</span>
            {copy.platform.eyebrow}
          </p>
          <h2>
            {copy.platform.line1}
            <br />
            {copy.platform.line2}
          </h2>
          <p>{copy.platform.body}</p>
        </div>
        <FeatureShowcase
          featureCopy={copy.features}
          previewCopy={copy.preview}
          previewData={previewData}
          label={copy.platform.tabs}
        />
      </section>

      <Story
        id="pos"
        number="02"
        {...copy.stories.pos}
        visual={<MarketingPreview view="cashier" copy={copy.preview} data={previewData} />}
      />

      <Story
        id="inventory"
        number="03"
        {...copy.stories.inventory}
        visual={<MarketingPreview view="inventory" copy={copy.preview} data={previewData} />}
        reverse
      />

      <section id="commerce" className={styles.commerceSection}>
        <div className={styles.commerceHeading} data-reveal>
          <p className={styles.eyebrow}>
            <span>04</span>
            {copy.commerce.eyebrow}
          </p>
          <h2>
            {copy.commerce.line1}
            <br />
            {copy.commerce.line2}
          </h2>
          <p>{copy.commerce.body}</p>
        </div>
        <div className={styles.commerceGrid}>
          <IntegrationFlow copy={copy} />
          <div className={styles.commerceScreenshot} data-reveal>
            <MarketingPreview view="commerce" copy={copy.preview} data={previewData} />
          </div>
        </div>
      </section>

      <Story
        id="analytics"
        number="05"
        {...copy.stories.analytics}
        visual={<MarketingPreview view="analytics" copy={copy.preview} data={previewData} />}
        dark
      />

      <section id="mobile" className={styles.mobileSection}>
        <div className={styles.mobileCopy} data-reveal>
          <p className={styles.eyebrow}>
            <span>06</span>
            {copy.mobile.eyebrow}
          </p>
          <h2>{copy.mobile.title}</h2>
          <p>{copy.mobile.body}</p>
          <div className={styles.mobileBadges}>
            <span>{copy.mobile.badges[0]}</span>
            <span>{copy.mobile.badges[1]}</span>
            <span>{copy.mobile.badges[2]}</span>
          </div>
        </div>
        <div className={styles.deviceStage} data-reveal>
          <div className={styles.tabletFrame}>
            <MarketingPreview copy={copy.preview} data={previewData} />
          </div>
          <div className={styles.mobilePhoneFrame} role="img" aria-label={copy.mobile.phoneAlt}>
            <div className={styles.phoneSpeaker} aria-hidden="true" />
            <div className={styles.mobileReceipt} aria-hidden="true">
              <div>
                <Image src="/brand/icon.png" width={24} height={24} alt="" />
                <span>BAZAAR</span>
              </div>
              <small>{copy.preview.demo}</small>
              <h3>{copy.preview.cart}</h3>
              <p>{copy.preview.retail}</p>
              {copy.preview.items.slice(0, 2).map((name, index) => (
                <article key={name}>
                  <span>{name}</span>
                  <strong>{formatCurrency(index ? 290 : 750, locale, "KGS")}</strong>
                  <small>
                    {index ? "1" : "2"} × {formatCurrency(index ? 290 : 375, locale, "KGS")}
                  </small>
                </article>
              ))}
              <div className={styles.mobileTotal}>
                <span>{copy.preview.total}</span>
                <strong>{formatCurrency(1040, locale, "KGS")}</strong>
              </div>
              <span className={styles.mobilePayment}>{copy.preview.payment}</span>
            </div>
          </div>
        </div>
      </section>

      <section id="getting-started" className={styles.startSection} aria-labelledby="start-title">
        <div className={styles.sectionHeading} data-reveal>
          <p className={styles.eyebrow}>
            <span>07</span>
            {copy.gettingStarted.eyebrow}
          </p>
          <h2 id="start-title">{copy.gettingStarted.title}</h2>
          <p>{copy.gettingStarted.body}</p>
        </div>
        <ol className={styles.startSteps}>
          {copy.gettingStarted.steps.map((step, index) => (
            <li key={step.title} data-reveal>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
        <div className={styles.startHelp}>
          <span>{copy.gettingStarted.help}</span>
          <a href={whatsappUrl}>
            {copy.gettingStarted.contact}
            <Arrow />
          </a>
        </div>
      </section>

      <MarketingPricing plans={plans} locale={locale} t={t} />

      <section id="faq" className={styles.faqSection} aria-labelledby="faq-title">
        <div>
          <p className={styles.eyebrow}>{copy.faq.eyebrow}</p>
          <h2 id="faq-title">{copy.faq.title}</h2>
        </div>
        <div className={styles.faqList}>
          {copy.faq.items.map((item) => (
            <details key={item.question}>
              <summary>
                {item.question}
                <span aria-hidden="true">+</span>
              </summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={styles.finalCta}>
        <div data-reveal>
          <p>{copy.final.tag}</p>
          <h2>
            {copy.final.line1}
            <br />
            {copy.final.line2}
          </h2>
          <div className={styles.finalActions}>
            <Link href="/signup">
              {copy.final.start} <Arrow />
            </Link>
            <a href={whatsappUrl}>{copy.final.contact}</a>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <Link href="/" aria-label={copy.nav.home}>
            <Image src="/brand/icon.png" alt="" width={34} height={34} />
            <span>BAZAAR</span>
          </Link>
          <p>{copy.footer.description}</p>
        </div>
        <div className={styles.footerLinks}>
          <div>
            <h3>{copy.footer.product}</h3>
            <a href="#pos">{copy.stories.pos.eyebrow}</a>
            <a href="#inventory">{copy.stories.inventory.eyebrow}</a>
            <a href="#analytics">{copy.stories.analytics.eyebrow}</a>
          </div>
          <div>
            <h3>{copy.footer.solutions}</h3>
            <a href="#platform">Retail OS</a>
            <a href="#mobile">Mobile / PWA</a>
            <a href="#pricing">{copy.nav.pricing}</a>
          </div>
          <div>
            <h3>{copy.footer.integrations}</h3>
            <a href="#commerce">{copy.commerce.eyebrow}</a>
            <Link href="/developers/bazaar-api">Bazaar API</Link>
            <a href="#commerce">{copy.footer.marketplaces}</a>
          </div>
          <div>
            <h3>{copy.footer.company}</h3>
            <a href={whatsappUrl}>{copy.footer.contact}</a>
            <Link href="/login">{copy.nav.signIn}</Link>
            <Link href="/signup">{copy.footer.signup}</Link>
          </div>
          <div>
            <h3>{copy.footer.legal}</h3>
            <a href={`${whatsappUrl}?text=Legal%20information`}>{copy.footer.legal}</a>
            <Link href="/privacy">{copy.footer.privacy}</Link>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <span>© {new Date().getFullYear()} Bazaar</span>
          <MarketingLocaleSwitcher />
          <span>{copy.footer.made}</span>
        </div>
      </footer>
    </main>
  );
};
