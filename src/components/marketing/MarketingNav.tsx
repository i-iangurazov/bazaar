"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import styles from "./marketing.module.css";

export type MarketingNavCopy = {
  homeLabel: string;
  navigationLabel: string;
  mobileNavigationLabel: string;
  openMenuLabel: string;
  closeMenuLabel: string;
  signIn: string;
  startFree: string;
  signInWorkspace: string;
  links: Array<{ href: string; label: string }>;
};

export const MarketingNav = ({ copy }: { copy: MarketingNavCopy }) => {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      setScrolled(window.scrollY > 24);
      if (window.innerWidth >= 900) setOpen(false);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mobileNavRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      requestAnimationFrame(() => menuButtonRef.current?.focus());
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <header className={`${styles.nav} ${scrolled ? styles.navScrolled : ""}`}>
      <div className={styles.navInner}>
        <Link href="/" className={styles.brand} aria-label={copy.homeLabel}>
          <Image src="/brand/icon.png" width={34} height={34} alt="" priority />
          <span>BAZAAR</span>
        </Link>
        <nav className={styles.desktopNav} aria-label={copy.navigationLabel}>
          {copy.links.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className={styles.navActions}>
          <Link href="/login">{copy.signIn}</Link>
          <Link className={styles.navCta} href="/signup">
            {copy.startFree}
          </Link>
          <button
            ref={menuButtonRef}
            type="button"
            className={styles.menuButton}
            aria-label={open ? copy.closeMenuLabel : copy.openMenuLabel}
            aria-expanded={open}
            aria-controls="marketing-mobile-navigation"
            onClick={() => setOpen((current) => !current)}
          >
            <span />
            <span />
          </button>
        </div>
      </div>
      {open ? (
        <div ref={mobileNavRef} id="marketing-mobile-navigation" className={styles.mobileNav}>
          <nav aria-label={copy.mobileNavigationLabel}>
            {copy.links.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
                {link.label}
              </a>
            ))}
          </nav>
          <Link href="/login" onClick={() => setOpen(false)}>
            {copy.signInWorkspace}
          </Link>
          <Link href="/signup" className={styles.mobileNavCta} onClick={() => setOpen(false)}>
            {copy.startFree}
          </Link>
        </div>
      ) : null}
    </header>
  );
};
