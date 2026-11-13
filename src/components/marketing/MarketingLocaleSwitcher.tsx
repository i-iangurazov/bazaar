"use client";

import { useId, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { defaultLocale, locales, normalizeLocale } from "@/lib/locales";
import { marketingLanguageDestination } from "@/lib/marketingSeo";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
      startTransition(() => {
        const destination = marketingLanguageDestination(next, window.location.href);
        if (destination) {
          // Re-render the root locale provider as well as the landing itself.
          window.location.assign(destination);
        } else {
          router.refresh();
        }
      });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className={styles.localeControl}>
      <div className={styles.localeLabel}>
        <span id={`${errorId}-label`}>{t("language")}</span>
        <Select
          value={locale}
          disabled={pending || refreshing}
          onValueChange={(value) => void change(value)}
        >
          <SelectTrigger className="w-24" aria-labelledby={`${errorId}-label`}
            aria-busy={pending || refreshing} aria-describedby={failed ? errorId : undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
          {locales.map((item) => (
            <SelectItem key={item} value={item}>
              {item.toUpperCase()}
            </SelectItem>
          ))}
          </SelectContent>
        </Select>
      </div>
      {failed ? (
        <p role="alert" id={errorId} className={styles.localeError}>
          {tErrors("genericMessage")}
        </p>
      ) : null}
    </div>
  );
}
