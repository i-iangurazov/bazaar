"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type RevealProps = {
  children: ReactNode;
  className?: string;
  delayMs?: number;
  once?: boolean;
  threshold?: number;
  yOffset?: number;
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

export const Reveal = ({
  children,
  className,
  delayMs = 0,
  once = true,
  threshold = 0.15,
  yOffset = 18,
}: RevealProps) => {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [isVisible, setIsVisible] = useState(false);
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prefersReducedMotion) {
      setIsVisible(true);
      return;
    }

    const node = nodeRef.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) {
          return;
        }
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (once) {
            observer.unobserve(node);
          }
          return;
        }
        if (!once) {
          setIsVisible(false);
        }
      },
      { threshold, rootMargin: "0px 0px -10% 0px" },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [once, prefersReducedMotion, threshold]);

  const style: CSSProperties | undefined = prefersReducedMotion
    ? undefined
    : {
        transitionDelay: `${delayMs}ms`,
        transform: isVisible ? "translateY(0px)" : `translateY(${yOffset}px)`,
      };

  return (
    <div
      ref={nodeRef}
      style={style}
      className={cn(
        "transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
        prefersReducedMotion ? "opacity-100" : isVisible ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
};

