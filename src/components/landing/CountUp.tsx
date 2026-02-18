"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type CountUpProps = {
  value: number;
  className?: string;
  durationMs?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
};

const usePrefersReducedMotion = () => {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return reducedMotion;
};

export const CountUp = ({
  value,
  className,
  durationMs = 1200,
  prefix = "",
  suffix = "",
  decimals = 0,
}: CountUpProps) => {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [displayValue, setDisplayValue] = useState(0);
  const [shouldStart, setShouldStart] = useState(false);
  const nodeRef = useRef<HTMLSpanElement>(null);

  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }),
    [decimals],
  );

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldStart(true);
          observer.unobserve(node);
        }
      },
      { threshold: 0.35, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldStart) {
      return;
    }

    if (prefersReducedMotion) {
      setDisplayValue(value);
      return;
    }

    const startedAt = performance.now();
    let rafId = 0;

    const tick = (time: number) => {
      const elapsed = time - startedAt;
      const progress = Math.min(elapsed / durationMs, 1);
      const nextValue = value * (1 - Math.pow(1 - progress, 3));
      setDisplayValue(nextValue);

      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [durationMs, prefersReducedMotion, shouldStart, value]);

  const roundedValue = Number(displayValue.toFixed(decimals));

  return (
    <span ref={nodeRef} className={className}>
      {prefix}
      {formatter.format(roundedValue)}
      {suffix}
    </span>
  );
};

