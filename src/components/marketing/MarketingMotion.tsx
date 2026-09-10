"use client";

import { useEffect } from "react";

import styles from "./marketing.module.css";

export const MarketingMotion = () => {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-marketing-root]");
    if (!root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));

    if (reducedMotion || !("IntersectionObserver" in window)) {
      root.dataset.marketingMotion = "reduced";
      targets.forEach((target) => target.classList.add(styles.revealed));
      return;
    }

    root.dataset.marketingMotion = "ready";
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add(styles.revealed);
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  return null;
};
