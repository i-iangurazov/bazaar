"use client";

import { useId, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { defaultLocale, locales, normalizeLocale } from "@/lib/locales";
import styles from "./marketing.module.css";

export function MarketingLocaleSwitcher() {
  const locale = normalizeLocale(useLocale()) ?? defaultLocale;
  const t = useTranslations("common");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const errorId = useId();
  const [pending, setPending] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const change = async (value: string) => {
    const next = normalizeLocale(value);
    if (!next || next === locale || pending || refreshing) return;
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      if (!response.ok) throw new Error();
      startTransition(() => router.refresh());
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className={styles.localeControl}>
      <label className={styles.localeLabel}>
        <span>{t("language")}</span>
        <select
          value={locale}
          disabled={pending || refreshing}
          aria-busy={pending || refreshing}
          aria-describedby={failed ? errorId : undefined}
          onChange={(event) => void change(event.target.value)}
        >
          {locales.map((item) => (
            <option key={item} value={item}>
              {item.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      {failed ? (
        <p role="alert" id={errorId} className={styles.localeError}>
          {tErrors("genericMessage")}
        </p>
      ) : null}
    </div>
  );
}
