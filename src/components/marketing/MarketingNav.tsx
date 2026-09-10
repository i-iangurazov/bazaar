"use client";

import Image from "next/image";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { locales, type Locale } from "@/lib/locales";
import { MarketingIcon } from "./MarketingIcon";
import styles from "./marketing.module.css";

const navigation = ["platform", "workflows", "pricing", "faq"] as const;

export const MarketingNav = () => {
  const t = useTranslations("marketing");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [changingLanguage, setChangingLanguage] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [languageError, setLanguageError] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const anchorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    if (!dialog) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    dialog.showModal();
    const wide = window.matchMedia("(min-width: 1200px)");
    const onResize = () => {
      if (wide.matches) setOpen(false);
    };
    wide.addEventListener("change", onResize);
    return () => {
      wide.removeEventListener("change", onResize);
      dialog.close();
      Object.assign(body.style, previous);
      window.scrollTo({ top: scrollY, behavior: "instant" });
      const anchor = anchorRef.current;
      anchorRef.current = null;
      if (anchor) {
        const target = document.getElementById(anchor);
        history.pushState(null, "", `#${anchor}`);
        target?.scrollIntoView({ behavior: "instant" });
        target?.focus({ preventScroll: true });
      } else trigger?.focus({ preventScroll: true });
    };
  }, [open]);

  const changeLanguage = async (nextLocale: Locale) => {
    if (nextLocale === locale || changingLanguage || refreshing) return;
    setChangingLanguage(true);
    setLanguageError(false);
    try {
      const response = await fetch("/api/locale", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      });
      if (!response.ok) throw new Error("localeUpdateFailed");
      startTransition(() => router.refresh());
    } catch {
      setLanguageError(true);
    } finally {
      setChangingLanguage(false);
    }
  };

  const languagePicker = () => (
    <div
      className={styles.languages}
      role="group"
      aria-label={t("nav.language")}
      aria-busy={changingLanguage || refreshing}
    >
      {locales.map((value) => (
        <button
          key={value}
          type="button"
          lang={value === "kg" ? "ky" : value}
          aria-label={{ ru: "Русский", kg: "Кыргызча", en: "English" }[value]}
          aria-pressed={locale === value}
          disabled={changingLanguage || refreshing}
          onClick={() => void changeLanguage(value)}
        >
          {value.toUpperCase()}
        </button>
      ))}
    </div>
  );
  const brand = (
    <>
      <Image src="/brand/icon.png" width={32} height={32} alt="" priority />
      <span>BAZAAR</span>
    </>
  );

  return (
    <header className={styles.nav}>
      <a href="#main-content" className={styles.skipLink}>
        {t("nav.skip")}
      </a>
      <div className={styles.navInner}>
        <Link href="/" className={styles.brand} aria-label={t("nav.home")}>
          {brand}
        </Link>
        <nav className={styles.desktopNav} aria-label={t("nav.label")}>
          {navigation.map((id) => (
            <a key={id} href={`#${id}`}>
              {t(`nav.${id}`)}
            </a>
          ))}
        </nav>
        <div className={styles.navActions}>
          <div className={styles.desktopLanguages}>{languagePicker()}</div>
          <Link className={styles.navLogin} href="/login">
            {t("actions.login")}
          </Link>
          <Link className={styles.navCta} href="/signup">
            {t("actions.start")}
            <MarketingIcon />
          </Link>
          <button
            ref={triggerRef}
            className={styles.menuButton}
            type="button"
            aria-label={t("nav.open")}
            aria-expanded={open}
            aria-controls="marketing-mobile-navigation"
            onClick={() => setOpen(true)}
          >
            <MarketingIcon name="menu" />
          </button>
        </div>
      </div>
      {languageError && !open && (
        <p className={styles.languageError} role="alert">
          {t("nav.languageError")}
        </p>
      )}
      <dialog
        ref={dialogRef}
        id="marketing-mobile-navigation"
        className={styles.mobileNav}
        aria-label={t("nav.label")}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const dialog = event.currentTarget;
          const focusable = Array.from(
            dialog.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), [tabindex="0"]'),
          ).filter((node) => node.getClientRects().length > 0);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first || !dialog.contains(document.activeElement))
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
      >
        <div className={styles.mobileNavHeader}>
          <span className={styles.brand}>{brand}</span>
          <button
            type="button"
            className={styles.menuButton}
            aria-label={t("nav.close")}
            onClick={() => setOpen(false)}
            autoFocus
          >
            <MarketingIcon name="close" />
          </button>
        </div>
        <div className={styles.mobileNavBody}>
          <p className={styles.eyebrow}>{t("nav.explore")}</p>
          <nav aria-label={t("nav.label")}>
            {navigation.map((id, i) => (
              <a
                key={id}
                href={`#${id}`}
                onClick={(event) => {
                  event.preventDefault();
                  anchorRef.current = id;
                  setOpen(false);
                }}
              >
                <span>0{i + 1}</span>
                {t(`nav.${id}`)}
                <MarketingIcon />
              </a>
            ))}
          </nav>
          <div className={styles.mobileNavBottom}>
            {languagePicker()}
            {languageError && (
              <p className={styles.languageError} role="alert">
                {t("nav.languageError")}
              </p>
            )}
            <Link href="/signup" className={styles.primaryCta} onClick={() => setOpen(false)}>
              {t("actions.start")}
              <MarketingIcon />
            </Link>
            <Link href="/login" className={styles.mobileLogin} onClick={() => setOpen(false)}>
              {t("actions.login")}
            </Link>
          </div>
        </div>
      </dialog>
    </header>
  );
};
