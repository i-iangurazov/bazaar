import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Fragment, type ReactNode } from "react";

import { FeatureShowcase, type MarketingFeature } from "./FeatureShowcase";
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

const IntegrationFlow = ({
  ariaLabel,
  title,
  subtitle,
  status,
  pipeline,
  channels,
}: {
  ariaLabel: string;
  title: string;
  subtitle: string;
  status: string;
  pipeline: string[];
  channels: Array<{ mark: string; label: string; data: string }>;
}) => (
  <div className={styles.integrationConsole} aria-label={ariaLabel}>
    <div className={styles.integrationConsoleHeader}>
      <div className={styles.integrationIdentity}>
        <Image src="/brand/icon.png" width={42} height={42} alt="" />
        <p>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </p>
      </div>
      <span className={styles.liveStatus}>
        <i aria-hidden="true" />
        {status}
      </span>
    </div>
    <div className={styles.integrationPipeline} aria-hidden="true">
      {pipeline.map((item, index) => (
        <Fragment key={item}>
          {index > 0 ? <b>→</b> : null}
          <span>{item}</span>
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
            {status}
          </small>
        </div>
      ))}
    </div>
  </div>
);

export const MarketingLanding = async () => {
  const t = await getTranslations("landing");
  const tLegal = await getTranslations("legal");
  const tPrivacy = await getTranslations("privacy");
  const plans = [
    {
      name: t("pricing.starterName"),
      description: t("pricing.starterDescription"),
      price: "1 750",
      stores: t("pricing.starterStores"),
      features: [
        t("pricing.starterFeature1"),
        t("pricing.starterFeature2"),
        t("pricing.starterFeature3"),
      ],
      comparison: t("pricing.starterComparison"),
    },
    {
      name: t("pricing.growthName"),
      description: t("pricing.growthDescription"),
      price: "4 375",
      stores: t("pricing.growthStores"),
      features: [
        t("pricing.growthFeature1"),
        t("pricing.growthFeature2"),
        t("pricing.growthFeature3"),
      ],
      comparison: t("pricing.growthComparison"),
      recommended: true,
    },
    {
      name: t("pricing.networkName"),
      description: t("pricing.networkDescription"),
      price: "8 750",
      stores: t("pricing.networkStores"),
      features: [
        t("pricing.networkFeature1"),
        t("pricing.networkFeature2"),
        t("pricing.networkFeature3"),
      ],
      comparison: t("pricing.networkComparison"),
    },
  ];
  const features: MarketingFeature[] = [
    {
      id: "cashier",
      label: t("capabilities.pos.title"),
      eyebrow: "POS / Checkout",
      title: t("workflows.sell.title"),
      body: t("capabilities.pos.description"),
      details: [t("workflows.sell.item1"), t("workflows.sell.item2"), t("workflows.sell.item3")],
      image: "/marketing/captures/pos-desktop-wide.webp",
      alt: t("capabilities.pos.title"),
    },
    {
      id: "inventory",
      label: t("capabilities.inventory.title"),
      eyebrow: "Inventory / Movement",
      title: t("capabilities.inventory.title"),
      body: t("capabilities.inventory.description"),
      details: [
        t("workflows.control.item1"),
        t("workflows.control.item2"),
        t("workflows.control.item3"),
      ],
      image: "/marketing/captures/movements-wide.webp",
      alt: t("capabilities.inventory.title"),
    },
    {
      id: "products",
      label: t("capabilities.catalog.title"),
      eyebrow: "Products / Catalog",
      title: t("capabilities.catalog.title"),
      body: t("capabilities.catalog.description"),
      details: [
        t("workflows.assortment.item1"),
        t("workflows.assortment.item2"),
        t("workflows.assortment.item3"),
      ],
      image: "/marketing/captures/products-wide.webp",
      alt: t("capabilities.catalog.title"),
    },
    {
      id: "purchasing",
      label: t("capabilities.purchasing.title"),
      eyebrow: "Purchasing / Receiving",
      title: t("capabilities.purchasing.title"),
      body: t("capabilities.purchasing.description"),
      details: [
        t("capabilities.labels.title"),
        t("capabilities.imports.title"),
        t("capabilities.stores.title"),
      ],
      image: "/marketing/captures/dashboard-wide.webp",
      alt: t("capabilities.purchasing.title"),
    },
    {
      id: "commerce",
      label: t("integrations.eyebrow"),
      eyebrow: "Channels / API",
      title: t("integrations.title"),
      body: t("integrations.subtitle"),
      details: [
        t("integrations.bazaarApi.title"),
        t("integrations.mMarket.title"),
        t("integrations.bakaiStore.title"),
      ],
      image: "/marketing/captures/integrations-wide.webp",
      alt: t("integrations.title"),
    },
    {
      id: "analytics",
      label: t("capabilities.reports.title"),
      eyebrow: "Analytics / Decisions",
      title: t("workflows.control.title"),
      body: t("capabilities.reports.description"),
      details: [
        t("workflows.control.item1"),
        t("workflows.control.item2"),
        t("workflows.control.item3"),
      ],
      image: "/marketing/captures/dashboard-wide.webp",
      alt: t("capabilities.reports.title"),
    },
  ];
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Bazaar",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, iOS PWA, Android PWA",
    description: t("meta.description"),
    url: "https://www.bazaar.kg/",
    offers: plans.map((plan, index) => ({
      "@type": "Offer",
      name: plan.name,
      price: ["1750", "4375", "8750"][index],
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
      <MarketingNav
        copy={{
          homeLabel: t("nav.homeLabel"),
          navigationLabel: t("nav.ariaLabel"),
          mobileNavigationLabel: t("nav.mobileAriaLabel"),
          openMenuLabel: t("nav.openMenu"),
          closeMenuLabel: t("nav.closeMenu"),
          signIn: t("actions.signIn"),
          startFree: t("actions.startFree"),
          signInWorkspace: t("actions.signInWorkspace"),
          links: [
            { href: "#platform", label: t("nav.platform") },
            { href: "#pos", label: t("nav.workflows") },
            { href: "#commerce", label: t("nav.integrations") },
            { href: "#pricing", label: t("nav.pricing") },
          ],
        }}
      />

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <p className={styles.heroKicker}>
              <span />
              {t("hero.badge")}
            </p>
            <h1 id="hero-title">{t("hero.title")}</h1>
            <p className={styles.heroLead}>{t("hero.subtitle")}</p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryCta} href="/signup">
                {t("actions.startFree")}
                <Arrow />
              </Link>
              <a className={styles.secondaryCta} href="#platform">
                {t("actions.seeInAction")}
              </a>
            </div>
            <p className={styles.heroNote}>{t("hero.note")}</p>
          </div>

          <div className={styles.heroVisual}>
            <div className={styles.heroDesktop}>
              <ProductWindow
                src="/marketing/captures/pos-desktop-wide.webp"
                alt={t("hero.desktopAlt")}
                priority
              />
            </div>
            <div className={styles.heroProducts} aria-hidden="true">
              <Image
                src="/marketing/captures/products-wide.webp"
                alt=""
                width={1920}
                height={1080}
                sizes="360px"
              />
            </div>
            <div className={styles.heroPhone}>
              <div className={styles.phoneSpeaker} aria-hidden="true" />
              <Image
                src="/marketing/captures/pos-mobile.webp"
                alt={t("hero.mobileAlt")}
                width={780}
                height={1688}
                sizes="(max-width: 767px) 36vw, 230px"
              />
            </div>
            <div className={styles.activityStack} aria-label={t("hero.activityLabel")}>
              <div>
                <Glyph>✓</Glyph>
                <p>
                  <b>{t("hero.saleCompleted")}</b>
                  <span>{t("hero.saleAmount")}</span>
                </p>
              </div>
              <div>
                <Glyph>−2</Glyph>
                <p>
                  <b>{t("hero.stockUpdated")}</b>
                  <span>{t("hero.stockItem")}</span>
                </p>
              </div>
              <div>
                <Glyph>O!</Glyph>
                <p>
                  <b>O! Market</b>
                  <span>{t("hero.productsSynced")}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className={styles.heroSystems} aria-label={t("hero.systemsLabel")}>
          {[
            "POS",
            t("console.products"),
            t("console.inventory"),
            t("capabilities.stores.title"),
            t("capabilities.reports.title"),
            t("integrations.eyebrow"),
            "Bazaar API",
            "Mobile / PWA",
          ].map((system) => (
            <span key={system}>{system}</span>
          ))}
        </div>
      </section>

      <section id="platform" className={styles.platformIntro}>
        <div className={styles.sectionHeading} data-reveal>
          <p className={styles.eyebrow}>
            <span>01</span>
            {t("capabilities.eyebrow")}
          </p>
          <h2>{t("capabilities.title")}</h2>
          <p>{t("capabilities.subtitle")}</p>
        </div>
        <FeatureShowcase features={features} tabListLabel={t("capabilities.eyebrow")} />
      </section>

      <Story
        id="pos"
        number="02"
        eyebrow="POS"
        title={t("workflows.sell.title")}
        description={t("workflows.sell.description")}
        bullets={[t("workflows.sell.item1"), t("workflows.sell.item2"), t("workflows.sell.item3")]}
        visual={
          <ProductWindow
            src="/marketing/captures/pos-desktop-wide.webp"
            alt={t("capabilities.pos.title")}
          />
        }
        dark
      />

      <Story
        id="inventory"
        number="03"
        eyebrow="Inventory"
        title={t("capabilities.inventory.title")}
        description={t("capabilities.inventory.description")}
        bullets={[
          t("workflows.control.item1"),
          t("workflows.control.item2"),
          t("workflows.control.item3"),
        ]}
        visual={
          <ProductWindow
            src="/marketing/captures/movements-wide.webp"
            alt={t("capabilities.inventory.title")}
          />
        }
        reverse
      />

      <section id="commerce" className={styles.commerceSection}>
        <div className={styles.commerceHeading} data-reveal>
          <p className={styles.eyebrow}>
            <span>04</span>Commerce
          </p>
          <h2>{t("integrations.title")}</h2>
          <p>{t("integrations.subtitle")}</p>
        </div>
        <div className={styles.commerceGrid}>
          <IntegrationFlow
            ariaLabel={t("console.channelsAriaLabel")}
            title={t("console.singleCatalog")}
            subtitle={t("console.singleSource")}
            status={t("console.syncEnabled")}
            pipeline={[
              t("console.products"),
              t("console.prices"),
              t("console.stock"),
              t("console.orders"),
            ]}
            channels={[
              {
                mark: "API",
                label: t("integrations.bazaarApi.title"),
                data: t("integrations.bazaarApi.description"),
              },
              {
                mark: "M",
                label: t("integrations.mMarket.title"),
                data: t("integrations.mMarket.description"),
              },
              {
                mark: "B",
                label: t("integrations.bakaiStore.title"),
                data: t("integrations.bakaiStore.description"),
              },
              {
                mark: "@",
                label: t("integrations.imageStudio.title"),
                data: t("integrations.imageStudio.description"),
              },
            ]}
          />
          <div className={styles.commerceScreenshot} data-reveal>
            <ProductWindow
              src="/marketing/captures/integrations-wide.webp"
              alt={t("integrations.title")}
            />
          </div>
        </div>
      </section>

      <Story
        id="analytics"
        number="05"
        eyebrow="Analytics"
        title={t("workflows.control.title")}
        description={t("capabilities.reports.description")}
        bullets={[
          t("workflows.control.item1"),
          t("workflows.control.item2"),
          t("workflows.control.item3"),
        ]}
        visual={
          <ProductWindow
            src="/marketing/captures/dashboard-wide.webp"
            alt={t("capabilities.reports.title")}
          />
        }
        dark
      />

      <section id="mobile" className={styles.mobileSection}>
        <div className={styles.mobileCopy} data-reveal>
          <p className={styles.eyebrow}>
            <span>06</span>Mobile / PWA
          </p>
          <h2>{t("mobile.title")}</h2>
          <p>{t("mobile.subtitle")}</p>
          <div className={styles.mobileBadges}>
            <span>{t("mobile.install")}</span>
            <span>{t("mobile.camera")}</span>
            <span>{t("mobile.themes")}</span>
          </div>
        </div>
        <div className={styles.deviceStage} data-reveal>
          <div className={styles.tabletFrame}>
            <Image
              src="/marketing/captures/dashboard-wide.webp"
              alt={t("mobile.tabletAlt")}
              width={1920}
              height={1080}
              sizes="700px"
            />
          </div>
          <div className={styles.mobilePhoneFrame}>
            <div aria-hidden="true" />
            <Image
              src="/marketing/captures/pos-mobile.webp"
              alt={t("mobile.phoneAlt")}
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
            {t("trust.eyebrow")}
          </p>
          <h2 id="proof-title">{t("trust.title")}</h2>
        </div>
        <p data-reveal>{t("trust.subtitle")}</p>
      </section>

      <section id="pricing" className={styles.pricingSection}>
        <div className={styles.sectionHeading} data-reveal>
          <p className={styles.eyebrow}>
            <span>08</span>
            {t("pricing.eyebrow")}
          </p>
          <h2>{t("pricing.title")}</h2>
          <p>{t("pricing.subtitle")}</p>
        </div>
        <div className={styles.planGrid}>
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`${styles.planCard} ${plan.recommended ? styles.planFeatured : ""}`}
              data-reveal
            >
              {plan.recommended ? (
                <span className={styles.recommended}>{t("pricing.recommended")}</span>
              ) : null}
              <h3>{plan.name}</h3>
              <p>{plan.description}</p>
              <div className={styles.planPrice}>
                <b>{plan.price}</b>
                <span>{t("pricing.currencyMonth")}</span>
              </div>
              <strong>{plan.stores}</strong>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <Check />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link href="/signup">
                {t("pricing.startFree")} <Arrow />
              </Link>
            </article>
          ))}
        </div>
        <details className={styles.planComparison}>
          <summary>
            {t("pricing.compare")} <Arrow />
          </summary>
          <div>
            {plans.map((plan) => (
              <p key={plan.name}>
                <b>{plan.name}</b>
                <span>{plan.comparison}</span>
              </p>
            ))}
          </div>
        </details>
      </section>

      <section className={styles.finalCta}>
        <div data-reveal>
          <p>Retail OS · Bazaar</p>
          <h2>
            {t("finalCta.title")}
            <br />
            {t("finalCta.subtitle")}
          </h2>
          <Link href="/signup">
            {t("finalCta.action")} <Arrow />
          </Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <Link href="/" aria-label={t("footer.homeLabel")}>
            <Image src="/brand/icon.png" alt="" width={34} height={34} />
            <span>BAZAAR</span>
          </Link>
          <p>{t("footer.tagline")}</p>
        </div>
        <nav className={styles.footerLinks} aria-label={t("footer.navigationLabel")}>
          <div>
            <h3>{t("footer.product")}</h3>
            <a href="#pos">{t("capabilities.pos.title")}</a>
            <a href="#inventory">{t("capabilities.inventory.title")}</a>
            <a href="#analytics">{t("capabilities.reports.title")}</a>
          </div>
          <div>
            <h3>{t("footer.solutions")}</h3>
            <a href="#platform">Retail OS</a>
            <a href="#mobile">{t("footer.mobile")}</a>
            <a href="#pricing">{t("pricing.eyebrow")}</a>
          </div>
          <div>
            <h3>{t("footer.integrations")}</h3>
            <a href="#commerce">{t("integrations.eyebrow")}</a>
            <Link href="/developers/bazaar-api">Bazaar API</Link>
            <a href="#commerce">{t("footer.marketplaces")}</a>
          </div>
          <div>
            <h3>{t("footer.support")}</h3>
            <a href={whatsappUrl}>{t("footer.contact")}</a>
            <Link href="/help">{t("footer.guide")}</Link>
            <Link href="/login">{t("actions.signIn")}</Link>
            <Link href="/signup">{t("footer.signUp")}</Link>
          </div>
          <div>
            <h3>{t("footer.legal")}</h3>
            <Link href="/legal">{tLegal("title")}</Link>
            <Link href="/privacy">{tPrivacy("title")}</Link>
          </div>
        </nav>
        <div className={styles.footerBottom}>
          <span>{t("footer.copyright", { year: new Date().getFullYear() })}</span>
          <span>{t("footer.madeForKyrgyzstan")}</span>
        </div>
      </footer>
    </main>
  );
};
