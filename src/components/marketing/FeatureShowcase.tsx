"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import styles from "./marketing.module.css";

const features = [
  {
    id: "cashier",
    label: "Касса",
    eyebrow: "POS / Checkout",
    title: "Продажа без лишних экранов",
    body: "Каталог, текущий чек, скидка, клиент и оплата находятся в одном рабочем контексте.",
    details: ["Штрихкод и поиск", "Разделённая оплата", "Отложить и продолжить"],
    image: "/marketing/captures/pos-desktop.webp",
    alt: "Интерфейс кассы Bazaar",
  },
  {
    id: "inventory",
    label: "Запасы",
    eyebrow: "Inventory / Movement",
    title: "Остаток с понятным происхождением",
    body: "Каждое изменение связано с продажей, поставкой, перемещением, списанием или пересчётом.",
    details: ["По магазинам", "По вариантам", "С полной историей"],
    image: "/marketing/captures/movements.webp",
    alt: "Журнал движения товаров Bazaar",
  },
  {
    id: "products",
    label: "Товары",
    eyebrow: "Products / Catalog",
    title: "Каталог, готовый к любому каналу",
    body: "Цены, варианты, штрихкоды, фото и доступность по магазинам управляются централизованно.",
    details: ["Варианты и опции", "Цены и скидки", "Импорт и bulk-действия"],
    image: "/marketing/captures/products.webp",
    alt: "Каталог товаров Bazaar",
  },
  {
    id: "customers",
    label: "Клиенты",
    eyebrow: "Customers / Retention",
    title: "Покупатель остаётся частью истории",
    body: "Контакты, заказы и маркетинговая доступность собраны в одной клиентской базе.",
    details: ["История заказов", "Сегменты", "Email Marketing"],
    image: "/marketing/captures/dashboard.webp",
    alt: "Рабочая панель Bazaar с данными магазина",
  },
  {
    id: "commerce",
    label: "Commerce",
    eyebrow: "Channels / API",
    title: "Один источник данных для всех каналов",
    body: "Bazaar API и маркетплейсы получают актуальные товары, цены и остатки из одной системы.",
    details: ["Bazaar API", "M-Market и Bakai", "O! Market"],
    image: "/marketing/captures/integrations.webp",
    alt: "Интеграции Bazaar",
  },
  {
    id: "analytics",
    label: "Аналитика",
    eyebrow: "Analytics / Decisions",
    title: "Цифры, связанные с операциями",
    body: "Продажи, себестоимость, маржа и запасы рассчитываются из реальных движений бизнеса.",
    details: ["Выручка", "Валовая прибыль", "Топ товаров"],
    image: "/marketing/captures/dashboard.webp",
    alt: "Аналитика Bazaar",
  },
] as const;

export const FeatureShowcase = () => {
  const [activeId, setActiveId] = useState<(typeof features)[number]["id"]>("cashier");
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const active = features.find((feature) => feature.id === activeId) ?? features[0];

  const moveFocus = (currentIndex: number, direction: number) => {
    const nextIndex = (currentIndex + direction + features.length) % features.length;
    const next = features[nextIndex];
    if (!next) return;
    setActiveId(next.id);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div className={styles.featureShowcase} data-reveal>
      <div className={styles.featureTabs} role="tablist" aria-label="Возможности Bazaar">
        {features.map((feature, index) => (
          <button
            key={feature.id}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`feature-tab-${feature.id}`}
            aria-controls={`feature-panel-${feature.id}`}
            aria-selected={active.id === feature.id}
            tabIndex={active.id === feature.id ? 0 : -1}
            onClick={() => setActiveId(feature.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                moveFocus(index, 1);
              }
              if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                moveFocus(index, -1);
              }
            }}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {feature.label}
          </button>
        ))}
      </div>
      <div
        className={styles.featurePanel}
        role="tabpanel"
        id={`feature-panel-${active.id}`}
        aria-labelledby={`feature-tab-${active.id}`}
      >
        <div className={styles.featureCopy} key={`${active.id}-copy`}>
          <p>{active.eyebrow}</p>
          <h3>{active.title}</h3>
          <span>{active.body}</span>
          <ul>
            {active.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </div>
        <div className={styles.featureImage} key={`${active.id}-image`}>
          <div className={styles.windowBar} aria-hidden="true">
            <span />
            <span />
            <span />
            <p>app.bazaar.kg</p>
          </div>
          <Image
            src={active.image}
            alt={active.alt}
            width={1440}
            height={active.image.includes("pos-desktop") ? 1000 : 900}
            sizes="(max-width: 767px) 92vw, (max-width: 1199px) 62vw, 820px"
          />
        </div>
      </div>
    </div>
  );
};
