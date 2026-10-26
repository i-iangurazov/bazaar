"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { MarketingCopy } from "@/content/marketing";

import styles from "./marketing.module.css";

export const MarketingNav = ({ copy }: { copy: MarketingCopy["nav"] }) => {
  const links = [
    { href: "#platform", label: copy.product },
    { href: "#pos", label: copy.features },
    { href: "#commerce", label: copy.integrations },
    { href: "#pricing", label: copy.pricing },
  ];
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<string | null>(null);

  useEffect(() => {
    const update = () => {
      if (!open) setScrolled(window.scrollY > 24);
    };
    const resize = () => {
      update();
      if (window.innerWidth >= 1000) setOpen(false);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", resize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const navigation = navigationRef.current;
    const menuButton = menuButtonRef.current;
    if (!navigation) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    Object.assign(body.style, {
      position: "fixed",
      top: `-${scrollY}px`,
      width: "100%",
      overflow: "hidden",
    });
    // The modal lives inside the landing, without changing shared menus or dialogs.
    const siblings = Array.from(navigation.parentElement?.children ?? [])
      .filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && element !== navigation,
      )
      .map((element) => ({ element, inert: element.inert }));
    siblings.forEach(({ element }) => {
      element.inert = true;
    });
    mobileNavRef.current?.querySelector<HTMLAnchorElement>("a")?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        navigation.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)"),
      ).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !navigation.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      siblings.forEach(({ element, inert }) => {
        element.inert = inert;
      });
      Object.assign(body.style, previous);
      window.scrollTo({ top: scrollY, behavior: "instant" });
      const anchor = anchorRef.current;
      anchorRef.current = null;
      if (anchor) {
        const target = document.getElementById(anchor);
        if (target) {
          history.pushState(null, "", `#${anchor}`);
          const headerHeight =
            navigation.querySelector("header")?.getBoundingClientRect().height ?? 76;
          window.scrollTo({
            top: target.getBoundingClientRect().top + scrollY - headerHeight - 8,
            behavior: "instant",
          });
          const previousTabIndex = target.getAttribute("tabindex");
          target.tabIndex = -1;
          target.focus({ preventScroll: true });
          target.addEventListener(
            "blur",
            () => {
              if (previousTabIndex === null) target.removeAttribute("tabindex");
              else target.setAttribute("tabindex", previousTabIndex);
            },
            { once: true },
          );
        }
      } else {
        // The mobile trigger disappears at the desktop breakpoint. Keep focus
        // on the visible brand link when resize closes the menu.
        const target =
          window.innerWidth >= 1000
            ? navigation.querySelector<HTMLAnchorElement>("a[href]")
            : menuButton;
        target?.focus({ preventScroll: true });
      }
    };
  }, [open]);

  return (
    <div
      ref={navigationRef}
      className={open ? styles.navOverlay : undefined}
      role={open ? "dialog" : undefined}
      aria-modal={open ? true : undefined}
      aria-label={open ? copy.mobile : undefined}
    >
      <header
        className={`${styles.nav} ${scrolled ? styles.navScrolled : ""} ${open ? styles.navOpen : ""}`}
      >
        <div className={styles.navInner}>
          <Link
            href="/"
            className={styles.brand}
            aria-label={copy.home}
            onClick={() => setOpen(false)}
          >
            <Image src="/brand/icon.png" width={34} height={34} alt="" priority />
            <span>BAZAAR</span>
          </Link>
          <nav className={styles.desktopNav} aria-label={copy.primary}>
            {links.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className={styles.navActions}>
            <Link href="/login">{copy.signIn}</Link>
            <Link className={styles.navCta} href="/signup">
              {copy.start}
            </Link>
            <button
              ref={menuButtonRef}
              type="button"
              className={styles.menuButton}
              aria-label={open ? copy.close : copy.open}
              aria-expanded={open}
              aria-controls={open ? "marketing-mobile-navigation" : undefined}
              onClick={() => setOpen((current) => !current)}
            >
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>
      {/* Outside the filtered header: fixed positioning must remain relative to the viewport. */}
      {open ? (
        <div ref={mobileNavRef} id="marketing-mobile-navigation" className={styles.mobileNav}>
          <nav aria-label={copy.mobile}>
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={(event) => {
                  event.preventDefault();
                  anchorRef.current = link.href.slice(1);
                  setOpen(false);
                }}
              >
                {link.label}
              </a>
            ))}
          </nav>
          <Link href="/login" onClick={() => setOpen(false)}>
            {copy.signInBazaar}
          </Link>
          <Link href="/signup" className={styles.mobileNavCta} onClick={() => setOpen(false)}>
            {copy.start}
          </Link>
        </div>
      ) : null}
    </div>
  );
};
