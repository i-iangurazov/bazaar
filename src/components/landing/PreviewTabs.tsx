"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type PreviewTab = {
  id: string;
  label: string;
  title: string;
  description: string;
  points: string[];
};

type PreviewTabsProps = {
  tabs: PreviewTab[];
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

export const PreviewTabs = ({ tabs }: PreviewTabsProps) => {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [activeId, setActiveId] = useState(tabs[0]?.id ?? "");

  if (!tabs.length) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Preview tabs"
        className="inline-flex w-full flex-wrap gap-2 rounded-xl border border-border bg-secondary/50 p-1"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`preview-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`preview-panel-${tab.id}`}
              onClick={() => setActiveId(tab.id)}
              className={cn(
                "flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="relative min-h-[220px] overflow-hidden rounded-lg border border-border bg-card p-4">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <div
              key={tab.id}
              role="tabpanel"
              id={`preview-panel-${tab.id}`}
              aria-labelledby={`preview-tab-${tab.id}`}
              aria-hidden={!isActive}
              className={cn(
                "absolute inset-0 p-4 transition-opacity duration-300",
                prefersReducedMotion ? "" : "ease-out",
                isActive ? "opacity-100" : "pointer-events-none opacity-0",
              )}
            >
              <p className="text-sm font-semibold text-foreground">{tab.title}</p>
              <p className="mt-2 text-sm text-muted-foreground">{tab.description}</p>
              <ul className="mt-4 space-y-2 text-sm text-foreground">
                {tab.points.map((point) => (
                  <li key={point} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
};

