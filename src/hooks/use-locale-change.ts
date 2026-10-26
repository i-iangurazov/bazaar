"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "next-intl";

/** Refresh displayed validation after an interface-language change, keeping form values. */
export function useLocaleChange(onChange: () => void) {
  const locale = useLocale();
  const previousLocale = useRef(locale);
  useEffect(() => {
    if (previousLocale.current === locale) return;
    previousLocale.current = locale;
    onChange();
  }, [locale, onChange]);
}
