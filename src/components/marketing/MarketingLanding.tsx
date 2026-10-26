import { marketingCaptures } from "@/content/marketing/assets";
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
import styles from "./marketing.module.css";

const whatsappUrl = "https://wa.me/996709911300";

const Glyph = ({ children }: { children: ReactNode }) => (
  <span className={styles.glyph} aria-hidden="true">
    {children}
  </span>
);

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

const ProductWindow = ({
  src,
  alt,
  priority = false,
  className,
}: {
  src: string;
  alt: string;
  priority?: boolean;
  className?: string;
}) => (
  <div className={`${styles.productWindow} ${className ?? ""}`}>
    <div className={styles.windowBar} aria-hidden="true">
      <span />
      <span />
      <span />
      <p>app.bazaar.kg</p>
    </div>
    <div className={styles.productWindowViewport}>
      <Image
        src={src}
        alt={alt}
        width={1920}
        height={1080}
        sizes="(max-width: 767px) 94vw, (max-width: 1199px) 88vw, 1120px"
        priority={priority}
      />
    </div>
  </div>
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
            <h1 id="hero-title">{copy.hero.title}</h1>
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
            <div className={styles.heroDesktop}>
              <ProductWindow
                src={marketingCaptures.posDesktop}
                alt={copy.hero.desktopAlt}
                priority
              />
            </div>
            <div className={styles.heroProducts} aria-hidden="true">
              <Image
                src={marketingCaptures.products}
                alt=""
                width={1920}
                height={1080}
                sizes="360px"
              />
            </div>
            <div className={styles.heroPhone}>
              <div className={styles.phoneSpeaker} aria-hidden="true" />
              <Image
                src={marketingCaptures.posMobile}
                alt={copy.hero.mobileAlt}
                width={780}
                height={1688}
                sizes="(max-width: 767px) 36vw, 230px"
              />
            </div>
            <div className={styles.activityStack} aria-label={copy.hero.activityLabel}>
              <div>
                <Glyph>✓</Glyph>
                <p>
                  <b>{copy.hero.sale}</b>
                  <span>{formatCurrency(3220, locale, "KGS")}</span>
                </p>
              </div>
              <div>
                <Glyph>−2</Glyph>
                <p>
                  <b>{copy.hero.stock}</b>
                  <span>{copy.hero.product}</span>
                </p>
              </div>
              <div>
                <Glyph>O!</Glyph>
                <p>
                  <b>O! Market</b>
                  <span>{copy.hero.channelActivity}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className={styles.heroSystems} aria-label={copy.hero.systemsLabel}>
          {copy.hero.systems.map((system) => (
            <span key={system}>{system}</span>
          ))}
        </div>
      </section>

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
        <FeatureShowcase featureCopy={copy.features} label={copy.platform.tabs} />
      </section>

      <Story
        id="pos"
        number="02"
        {...copy.stories.pos}
        visual={<ProductWindow src={marketingCaptures.posDesktop} alt={copy.stories.pos.alt} />}
        dark
      />

      <Story
        id="inventory"
        number="03"
        {...copy.stories.inventory}
        visual={
          <ProductWindow src={marketingCaptures.movements} alt={copy.stories.inventory.alt} />
        }
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
            <ProductWindow src={marketingCaptures.integrations} alt={copy.commerce.alt} />
          </div>
        </div>
      </section>

      <Story
        id="analytics"
        number="05"
        {...copy.stories.analytics}
        visual={
          <ProductWindow src={marketingCaptures.dashboard} alt={copy.stories.analytics.alt} />
        }
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
            <Image
              src={marketingCaptures.dashboard}
              alt={copy.mobile.tabletAlt}
              width={1920}
              height={1080}
              sizes="700px"
            />
          </div>
          <div className={styles.mobilePhoneFrame}>
            <div aria-hidden="true" />
            <Image
              src={marketingCaptures.posMobile}
              alt={copy.mobile.phoneAlt}
              width={780}
              height={1688}
              sizes="240px"
            />
          </div>
        </div>
      </section>

      <section className={styles.proofSection} aria-labelledby="proof-title">
        <div data-reveal>
          <p className={styles.eyebrow}>
            <span>07</span>
            {copy.proof.eyebrow}
          </p>
          <h2 id="proof-title">{copy.proof.title}</h2>
        </div>
        <p data-reveal>{copy.proof.body}</p>
      </section>

      <MarketingPricing plans={plans} locale={locale} t={t} />

      <section className={styles.finalCta}>
        <div data-reveal>
          <p>{copy.final.tag}</p>
          <h2>
            {copy.final.line1}
            <br />
            {copy.final.line2}
          </h2>
          <Link href="/signup">
            {copy.final.start} <Arrow />
          </Link>
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
