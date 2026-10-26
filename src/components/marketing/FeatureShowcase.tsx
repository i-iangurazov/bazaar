"use client";

import { marketingCaptures } from "@/content/marketing/assets";

import Image from "next/image";
import { useRef, useState } from "react";

import type { MarketingCopy, MarketingFeatureId } from "@/content/marketing";

import styles from "./marketing.module.css";

const featureImages = [
  { id: "cashier", image: marketingCaptures.posDesktop },
  { id: "inventory", image: marketingCaptures.movements },
  { id: "products", image: marketingCaptures.products },
  { id: "customers", image: marketingCaptures.dashboard },
  { id: "commerce", image: marketingCaptures.integrations },
  { id: "analytics", image: marketingCaptures.dashboard },
] as const;

export const FeatureShowcase = ({
  featureCopy,
  label,
}: {
  featureCopy: MarketingCopy["features"];
  label: string;
}) => {
  const features = featureImages.map((feature) => ({
    ...feature,
    ...featureCopy[feature.id],
  }));
  const [activeId, setActiveId] = useState<MarketingFeatureId>("cashier");
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const active = features.find((feature) => feature.id === activeId) ?? features[0];

  const focusTab = (nextIndex: number) => {
    const next = features[nextIndex];
    if (!next) return;
    setActiveId(next.id);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div className={styles.featureShowcase} data-reveal>
      <div className={styles.featureTabs} role="tablist" aria-label={label}>
        {features.map((feature, index) => (
          <button
            key={feature.id}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`feature-tab-${feature.id}`}
            aria-controls="marketing-feature-panel"
            aria-selected={active.id === feature.id}
            tabIndex={active.id === feature.id ? 0 : -1}
            onClick={() => setActiveId(feature.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                focusTab((index + 1) % features.length);
              }
              if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                focusTab(event.key === "Home" ? 0 : features.length - 1);
              }
              if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                focusTab((index - 1 + features.length) % features.length);
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
        id="marketing-feature-panel"
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
