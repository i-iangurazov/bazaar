"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { CloseIcon, MenuIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

type StickyNavLink = {
  href: string;
  label: string;
};

type StickyNavProps = {
  links: StickyNavLink[];
  leftSlot: ReactNode;
  rightSlot: ReactNode;
  mobileSlot?: ReactNode;
  navAriaLabel: string;
  menuLabel?: string;
};

const resolveSectionId = (href: string) => href.replace(/^#/, "");

export const StickyNav = ({
  links,
  leftSlot,
  rightSlot,
  mobileSlot,
  navAriaLabel,
  menuLabel = "Меню",
}: StickyNavProps) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeHref, setActiveHref] = useState(links[0]?.href ?? "");
  const [mobileOpen, setMobileOpen] = useState(false);

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
      if (window.innerWidth >= 1024) {
        setMobileOpen(false);
      }
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
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6 lg:px-8">
        <div className="shrink-0">{leftSlot}</div>

        <nav
          aria-label={navAriaLabel}
          className="hidden flex-1 items-center justify-center gap-1 overflow-x-auto px-2 lg:flex"
        >
          {links.map((link) => {
            const isActive = activeHref === link.href;
            return (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setActiveHref(link.href)}
                className={cn(
                  "border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
                aria-current={isActive ? "location" : undefined}
              >
                {link.label}
              </a>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-2">{rightSlot}</div>
        <button
          type="button"
          className="button-focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm lg:hidden"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label={menuLabel}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? (
            <CloseIcon className="h-5 w-5" aria-hidden />
          ) : (
            <MenuIcon className="h-5 w-5" aria-hidden />
          )}
        </button>
      </div>

      {mobileOpen ? (
        <div className="border-t border-border bg-background/98 px-4 py-4 shadow-[0_18px_40px_-28px_hsl(var(--foreground)/0.6)] lg:hidden">
          <nav aria-label={navAriaLabel} className="grid gap-1">
            {links.map((link) => (
              <a
                key={`mobile-${link.href}`}
                href={link.href}
                onClick={() => {
                  setActiveHref(link.href);
                  setMobileOpen(false);
                }}
                className="rounded-md px-3 py-3 text-sm font-semibold text-foreground hover:bg-secondary"
              >
                {link.label}
              </a>
            ))}
          </nav>
          {mobileSlot ? <div className="mt-4 grid gap-2">{mobileSlot}</div> : null}
        </div>
      ) : null}
    </header>
  );
};
