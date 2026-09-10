"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { MarketingIcon } from "./MarketingIcon";
import styles from "./marketing.module.css";

const features = [
  { id: "sales", image: "/marketing/captures/pos-desktop-wide.webp", icon: "receipt" },
  { id: "stock", image: "/marketing/captures/products-wide.webp", icon: "box" },
  { id: "reports", image: "/marketing/captures/dashboard-wide.webp", icon: "chart" },
] as const;

export const FeatureShowcase = () => {
  const t = useTranslations("marketing.showcase");
  const [activeIndex, setActiveIndex] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div className={styles.featureShowcase}>
      <div className={styles.featureTabs} role="tablist" aria-label={t("label")}>
        {features.map((feature, index) => (
          <button
            ref={(node) => {
              refs.current[index] = node;
            }}
            key={feature.id}
            type="button"
            role="tab"
            id={`feature-tab-${feature.id}`}
            aria-controls={`feature-panel-${feature.id}`}
            aria-selected={activeIndex === index}
            tabIndex={activeIndex === index ? 0 : -1}
            onClick={() => setActiveIndex(index)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % features.length;
              else if (event.key === "ArrowLeft")
                next = (index - 1 + features.length) % features.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = features.length - 1;
              else return;
              event.preventDefault();
              setActiveIndex(next);
              refs.current[next]?.focus();
            }}
          >
            <MarketingIcon name={feature.icon} />
            {t(`${feature.id}.label`)}
          </button>
        ))}
      </div>
      {features.map((feature, index) => (
        <div
          key={feature.id}
          className={styles.featurePanel}
          role="tabpanel"
          id={`feature-panel-${feature.id}`}
          aria-labelledby={`feature-tab-${feature.id}`}
          hidden={index !== activeIndex}
          tabIndex={0}
        >
          <div className={styles.featureCopy}>
            <span className={styles.featureNumber}>0{index + 1} / 03</span>
            <h3>{t(`${feature.id}.title`)}</h3>
            <p>{t(`${feature.id}.body`)}</p>
            <ul>
              {(t.raw(`${feature.id}.details`) as string[]).map((detail) => (
                <li key={detail}>
                  <MarketingIcon name="check" />
                  {detail}
                </li>
              ))}
            </ul>
          </div>
          <figure className={styles.featureImage}>
            <div className={styles.captureBar}>
              <span />
              <span />
              <span />
              <small>bazaar.kg</small>
            </div>
            <Image
              src={feature.image}
              alt={t(`${feature.id}.alt`)}
              width={1920}
              height={1080}
              sizes="(max-width: 767px) 94vw, (max-width: 999px) 90vw, 850px"
            />
            <figcaption>
              <span>{t("caption")}</span>
              <a
                href={feature.image}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${t("openImage")}. ${t("newTab")}`}
              >
                {t("openImage")}
                <MarketingIcon />
              </a>
            </figcaption>
          </figure>
        </div>
      ))}
    </div>
  );
};
