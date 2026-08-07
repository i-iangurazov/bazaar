import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { FeatureShowcase } from "./FeatureShowcase";
import { MarketingMotion } from "./MarketingMotion";
import { MarketingNav } from "./MarketingNav";
import styles from "./marketing.module.css";

const whatsappUrl = "https://wa.me/996709911300";

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Bazaar",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web, iOS PWA, Android PWA",
  description:
    "Retail Operating System для кассы, товаров, запасов, клиентов, аналитики и каналов продаж.",
  url: "https://www.bazaar.kg/",
  offers: [
    { "@type": "Offer", name: "Новичок", price: "1750", priceCurrency: "KGS" },
    { "@type": "Offer", name: "Бизнесмен", price: "4375", priceCurrency: "KGS" },
    { "@type": "Offer", name: "Монополист", price: "8750", priceCurrency: "KGS" },
  ],
};

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
        width={1440}
        height={src.includes("pos-desktop") ? 1000 : 900}
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

const IntegrationFlow = () => (
  <div className={styles.integrationFlow} aria-label="Каналы продаж, синхронизированные с Bazaar">
    <div className={styles.flowLines} aria-hidden="true" />
    <div className={`${styles.integrationNode} ${styles.integrationCore}`}>
      <Image src="/brand/icon.png" width={40} height={40} alt="" />
      <span>Bazaar</span>
      <small>единый каталог</small>
    </div>
    {[
      ["API", "Bazaar API"],
      ["M", "M-Market"],
      ["B", "Bakai Store"],
      ["O!", "O! Market"],
      ["@", "Email Marketing"],
    ].map(([mark, label], index) => (
      <div
        key={label}
        className={`${styles.integrationNode} ${
          [styles.node1, styles.node2, styles.node3, styles.node4, styles.node5][index]
        }`}
      >
        <b>{mark}</b>
        <span>{label}</span>
        <small>синхронизировано</small>
      </div>
    ))}
  </div>
);

const plans = [
  {
    name: "Новичок",
    description: "Для первой точки и понятного старта.",
    price: "1 750",
    stores: "1 магазин",
    features: ["Касса и продажи", "Товары и остатки", "Клиентская база"],
  },
  {
    name: "Бизнесмен",
    description: "Для растущего розничного бизнеса.",
    price: "4 375",
    stores: "до 5 магазинов",
    features: ["Всё из Новичка", "Несколько магазинов", "Аналитика и интеграции"],
    recommended: true,
  },
  {
    name: "Монополист",
    description: "Для сети и сложных процессов.",
    price: "8 750",
    stores: "до 15 магазинов",
    features: ["Всё из Бизнесмена", "Управление сетью", "Расширенный контроль"],
  },
];

export const MarketingLanding = () => (
  <main className={styles.marketing} data-marketing-root>
    <MarketingMotion />
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
    />
    <MarketingNav />

    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.heroGlow} aria-hidden="true" />
      <div className={styles.heroGrid}>
        <div className={styles.heroCopy}>
          <p className={styles.heroKicker}>
            <span />
            Retail OS для современного магазина
          </p>
          <h1 id="hero-title">Весь ваш магазин. В одной системе.</h1>
          <p className={styles.heroLead}>
            Продажи, товары, остатки, клиенты, интернет-магазины и аналитика — синхронизированы в
            реальном времени.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryCta} href="/signup">
              Начать бесплатно
              <Arrow />
            </Link>
            <a className={styles.secondaryCta} href="#platform">
              Посмотреть Bazaar в действии
            </a>
          </div>
          <p className={styles.heroNote}>Без установки · Работает в браузере · Mobile/PWA</p>
        </div>

        <div className={styles.heroVisual}>
          <div className={styles.heroDesktop}>
            <ProductWindow
              src="/marketing/captures/pos-desktop.webp"
              alt="Настоящий интерфейс настольной кассы Bazaar с каталогом и текущим чеком"
              priority
            />
          </div>
          <div className={styles.heroProducts} aria-hidden="true">
            <Image
              src="/marketing/captures/products.webp"
              alt=""
              width={1440}
              height={900}
              sizes="360px"
              priority
            />
          </div>
          <div className={styles.heroPhone}>
            <div className={styles.phoneSpeaker} aria-hidden="true" />
            <Image
              src="/marketing/captures/pos-mobile.webp"
              alt="Настоящий мобильный интерфейс Bazaar POS"
              width={780}
              height={1688}
              sizes="(max-width: 767px) 36vw, 230px"
              priority
            />
          </div>
          <div className={styles.activityStack} aria-label="Примеры активности магазина">
            <div>
              <Glyph>✓</Glyph>
              <p>
                <b>Продажа завершена</b>
                <span>3 220 сом</span>
              </p>
            </div>
            <div>
              <Glyph>−2</Glyph>
              <p>
                <b>Остаток обновлён</b>
                <span>Матча Yuzu</span>
              </p>
            </div>
            <div>
              <Glyph>O!</Glyph>
              <p>
                <b>O! Market</b>
                <span>128 товаров синхронизировано</span>
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className={styles.heroSystems} aria-label="Системы Bazaar">
        {[
          "POS",
          "Products",
          "Inventory",
          "Customers",
          "Analytics",
          "Marketplaces",
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
          <span>01</span>Одна операционная система
        </p>
        <h2>
          Не набор модулей.
          <br />
          Один поток данных.
        </h2>
        <p>
          Продажа меняет остаток. Остаток обновляет каналы. Каналы возвращают заказы. Аналитика
          показывает результат — без ручной сверки между системами.
        </p>
      </div>
      <FeatureShowcase />
    </section>

    <Story
      id="pos"
      number="02"
      eyebrow="POS"
      title="Продавайте за секунды"
      description="Касса Bazaar оставляет кассиру только то, что нужно для быстрой и точной продажи — от сканирования до фискального результата."
      bullets={[
        "Поиск и штрихкод",
        "Клиент, скидка и разделённая оплата",
        "Отложенные чеки, возвраты и журнал",
      ]}
      visual={
        <ProductWindow src="/marketing/captures/pos-desktop.webp" alt="Настольная касса Bazaar" />
      }
      dark
    />

    <Story
      id="inventory"
      number="03"
      eyebrow="Inventory"
      title="Каждый товар под контролем"
      description="Поступления, перемещения, списания и пересчёты формируют одну прозрачную историю движения по каждому магазину и варианту."
      bullets={[
        "Текущий и минимальный остаток",
        "Оприходование, перемещение и списание",
        "Product Movement и себестоимость",
      ]}
      visual={
        <ProductWindow
          src="/marketing/captures/movements.webp"
          alt="История движения товаров в Bazaar"
        />
      }
      reverse
    />

    <section id="commerce" className={styles.commerceSection}>
      <div className={styles.commerceHeading} data-reveal>
        <p className={styles.eyebrow}>
          <span>04</span>Commerce
        </p>
        <h2>
          Один каталог.
          <br />
          Все каналы продаж.
        </h2>
        <p>
          Bazaar API, маркетплейсы и коммуникации с клиентами работают вокруг одного каталога, одной
          цены и одного остатка.
        </p>
      </div>
      <div className={styles.commerceGrid}>
        <IntegrationFlow />
        <div className={styles.commerceScreenshot} data-reveal>
          <ProductWindow
            src="/marketing/captures/integrations.webp"
            alt="Центр интеграций Bazaar"
          />
        </div>
      </div>
    </section>

    <Story
      id="analytics"
      number="05"
      eyebrow="Analytics"
      title="Видите не отчёты. Видите бизнес."
      description="Bazaar соединяет продажи, стоимость запасов и себестоимость, чтобы цифры отвечали на ежедневные вопросы владельца."
      bullets={[
        "Выручка и валовая прибыль",
        "Стоимость запасов и потенциальная маржа",
        "Топ товаров и сравнение магазинов",
      ]}
      visual={
        <ProductWindow
          src="/marketing/captures/dashboard.webp"
          alt="Бизнес-панель Bazaar с продажами и маржой"
        />
      }
      dark
    />

    <section id="mobile" className={styles.mobileSection}>
      <div className={styles.mobileCopy} data-reveal>
        <p className={styles.eyebrow}>
          <span>06</span>Mobile / PWA
        </p>
        <h2>Bazaar всегда с вами</h2>
        <p>
          Продажа, каталог и рабочие операции адаптированы под телефон и планшет. Это не уменьшенный
          desktop — мобильный сценарий собран отдельно.
        </p>
        <div className={styles.mobileBadges}>
          <span>Установка как приложение</span>
          <span>Сканирование камерой</span>
          <span>Светлая и тёмная темы</span>
        </div>
      </div>
      <div className={styles.deviceStage} data-reveal>
        <div className={styles.tabletFrame}>
          <Image
            src="/marketing/captures/dashboard.webp"
            alt="Bazaar на планшете"
            width={1440}
            height={900}
            sizes="700px"
          />
        </div>
        <div className={styles.mobilePhoneFrame}>
          <div aria-hidden="true" />
          <Image
            src="/marketing/captures/pos-mobile.webp"
            alt="Мобильная касса Bazaar"
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
          <span>07</span>Trust
        </p>
        <h2 id="proof-title">Доказательства, а не придуманные цифры.</h2>
      </div>
      <p data-reveal>
        Здесь появятся только подтверждённые кейсы, логотипы и показатели — после согласия клиентов.
        До этого Bazaar не публикует вымышленные отзывы или статистику.
      </p>
    </section>

    <section id="pricing" className={styles.pricingSection}>
      <div className={styles.sectionHeading} data-reveal>
        <p className={styles.eyebrow}>
          <span>08</span>Pricing
        </p>
        <h2>
          Понятные тарифы.
          <br />
          Без сложной математики.
        </h2>
        <p>Начните с одной точки и расширяйте систему вместе с бизнесом.</p>
      </div>
      <div className={styles.planGrid}>
        {plans.map((plan) => (
          <article
            key={plan.name}
            className={`${styles.planCard} ${plan.recommended ? styles.planFeatured : ""}`}
            data-reveal
          >
            {plan.recommended ? <span className={styles.recommended}>Рекомендуем</span> : null}
            <h3>{plan.name}</h3>
            <p>{plan.description}</p>
            <div className={styles.planPrice}>
              <b>{plan.price}</b>
              <span>сом / месяц</span>
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
              Начать бесплатно <Arrow />
            </Link>
          </article>
        ))}
      </div>
      <details className={styles.planComparison}>
        <summary>
          Сравнить тарифы <Arrow />
        </summary>
        <div>
          <p>
            <b>Новичок</b>
            <span>Основные операции одного магазина</span>
          </p>
          <p>
            <b>Бизнесмен</b>
            <span>Мультистор, расширенная аналитика и интеграции</span>
          </p>
          <p>
            <b>Монополист</b>
            <span>Сеть магазинов и расширенный контроль</span>
          </p>
        </div>
      </details>
    </section>

    <section className={styles.finalCta}>
      <div data-reveal>
        <p>Retail OS · Bazaar</p>
        <h2>
          Ваш магазин уже работает.
          <br />
          Теперь пусть он работает как система.
        </h2>
        <Link href="/signup">
          Начать с Bazaar <Arrow />
        </Link>
      </div>
    </section>

    <footer className={styles.footer}>
      <div className={styles.footerBrand}>
        <Link href="/" aria-label="Bazaar — на главную">
          <Image src="/brand/icon.png" alt="" width={34} height={34} />
          <span>BAZAAR</span>
        </Link>
        <p>Retail Operating System для современного магазина.</p>
      </div>
      <div className={styles.footerLinks}>
        <div>
          <h3>Product</h3>
          <a href="#pos">Касса</a>
          <a href="#inventory">Запасы</a>
          <a href="#analytics">Аналитика</a>
        </div>
        <div>
          <h3>Solutions</h3>
          <a href="#platform">Retail OS</a>
          <a href="#mobile">Mobile / PWA</a>
          <a href="#pricing">Тарифы</a>
        </div>
        <div>
          <h3>Integrations</h3>
          <a href="#commerce">Commerce</a>
          <Link href="/developers/bazaar-api">Bazaar API</Link>
          <a href="#commerce">Маркетплейсы</a>
        </div>
        <div>
          <h3>Company / Support</h3>
          <a href={whatsappUrl}>Связаться</a>
          <Link href="/login">Войти</Link>
          <Link href="/signup">Регистрация</Link>
        </div>
        <div>
          <h3>Legal</h3>
          <a href={`${whatsappUrl}?text=Legal%20information`}>Правовая информация</a>
          <a href={`${whatsappUrl}?text=Privacy%20request`}>Конфиденциальность</a>
        </div>
      </div>
      <div className={styles.footerBottom}>
        <span>© {new Date().getFullYear()} Bazaar</span>
        <span>Сделано для розничной торговли Кыргызстана</span>
      </div>
    </footer>
  </main>
);
