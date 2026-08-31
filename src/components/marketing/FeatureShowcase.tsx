"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import styles from "./marketing.module.css";

export type MarketingFeature = {
  id: string;
  label: string;
  eyebrow: string;
  title: string;
  body: string;
  details: string[];
  image: string;
  alt: string;
};

export const FeatureShowcase = ({
  features,
  tabListLabel,
}: {
  features: MarketingFeature[];
  tabListLabel: string;
}) => {
  const [activeId, setActiveId] = useState(features[0]?.id ?? "");
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const active = features.find((feature) => feature.id === activeId) ?? features[0];

  if (!active) {
    return null;
  }

  const moveFocus = (currentIndex: number, direction: number) => {
    const nextIndex = (currentIndex + direction + features.length) % features.length;
    const next = features[nextIndex];
    if (!next) return;
    setActiveId(next.id);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div className={styles.featureShowcase} data-reveal>
      <div className={styles.featureTabs} role="tablist" aria-label={tabListLabel}>
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
            width={1920}
            height={1080}
            sizes="(max-width: 767px) 92vw, (max-width: 1199px) 62vw, 820px"
          />
        </div>
      </div>
    </div>
  );
};
