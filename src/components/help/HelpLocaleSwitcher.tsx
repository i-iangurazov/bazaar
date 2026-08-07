"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";

import { defaultLocale, locales, normalizeLocale, type Locale } from "@/lib/locales";
import { localize, helpUi } from "@/content/help/ui";
import styles from "./help.module.css";

const labels: Record<Locale, string> = { ru: "RU", kg: "KG", en: "EN" };

export const HelpLocaleSwitcher = () => {
  const locale = normalizeLocale(useLocale()) ?? defaultLocale;
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const switchLocale = async (nextLocale: Locale) => {
    if (nextLocale === locale || pending) return;
    setPending(true);
    try {
      const response = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      });
      if (response.ok) router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className={styles.localeSwitcher}
      role="group"
      aria-label={localize(helpUi.language, locale)}
    >
      {locales.map((item) => (
        <button
          key={item}
          type="button"
          className={item === locale ? styles.localeActive : styles.localeButton}
          aria-pressed={item === locale}
          disabled={pending}
          onClick={() => void switchLocale(item)}
        >
          {labels[item]}
        </button>
      ))}
    </div>
  );
};
