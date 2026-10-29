"use client";

import { useRef, useState } from "react";

import type { MarketingCopy, MarketingFeatureId } from "@/content/marketing";

import styles from "./marketing.module.css";
import { MarketingPreview } from "./MarketingPreview";
import type { MarketingPreviewData } from "@/content/marketing/preview";

const featureIds: MarketingFeatureId[] = [
  "cashier",
  "inventory",
  "products",
  "customers",
  "commerce",
  "analytics",
];

export const FeatureShowcase = ({
  featureCopy,
  previewCopy,
  previewData,
  label,
}: {
  featureCopy: MarketingCopy["features"];
  previewCopy: MarketingCopy["preview"];
  previewData: MarketingPreviewData;
  label: string;
}) => {
  const features = featureIds.map((id) => ({ id, ...featureCopy[id] }));
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
          <MarketingPreview view={active.id} copy={previewCopy} data={previewData} />
        </div>
      </div>
    </div>
  );
};
