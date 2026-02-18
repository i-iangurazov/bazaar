"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type StickyNavLink = {
  href: string;
  label: string;
};

type StickyNavProps = {
  links: StickyNavLink[];
  leftSlot: ReactNode;
  rightSlot: ReactNode;
};

const resolveSectionId = (href: string) => href.replace(/^#/, "");

export const StickyNav = ({ links, leftSlot, rightSlot }: StickyNavProps) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeHref, setActiveHref] = useState(links[0]?.href ?? "");

  const sectionIds = useMemo(() => links.map((link) => resolveSectionId(link.href)), [links]);

  useEffect(() => {
    const updateState = () => {
      setIsScrolled(window.scrollY > 12);

      const offset = 140;
      let current = links[0]?.href ?? "";
      for (const id of sectionIds) {
        const section = document.getElementById(id);
        if (!section) {
          continue;
        }
        const top = section.getBoundingClientRect().top + window.scrollY;
        if (window.scrollY + offset >= top) {
          current = `#${id}`;
        }
      }
      setActiveHref(current);
    };

    updateState();
    window.addEventListener("scroll", updateState, { passive: true });
    window.addEventListener("resize", updateState);

    return () => {
      window.removeEventListener("scroll", updateState);
      window.removeEventListener("resize", updateState);
    };
  }, [links, sectionIds]);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-[background-color,box-shadow,border-color] duration-300",
        isScrolled
          ? "border-border/80 bg-background/95 shadow-[0_10px_30px_-24px_hsl(var(--foreground)/0.7)] backdrop-blur"
          : "border-transparent bg-background/75 backdrop-blur",
      )}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="shrink-0">{leftSlot}</div>

        <nav
          aria-label="Primary"
          className="hidden flex-1 items-center justify-center gap-1 overflow-x-auto px-2 md:flex"
        >
          {links.map((link) => {
            const isActive = activeHref === link.href;
            return (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setActiveHref(link.href)}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  isActive
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
                aria-current={isActive ? "location" : undefined}
              >
                {link.label}
              </a>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">{rightSlot}</div>
      </div>
    </header>
  );
};

