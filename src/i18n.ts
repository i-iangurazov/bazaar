import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { defaultLocale, getLocaleFromAcceptLanguage, normalizeLocale } from "@/lib/locales";
import { defaultTimeZone } from "@/lib/timezone";
import { createMessageFallback } from "@/lib/i18nFallback";

export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const cookieLocale = normalizeLocale(cookieStore.get("NEXT_LOCALE")?.value);
  const headerLocale = getLocaleFromAcceptLanguage(headerStore.get("accept-language"));
  const resolvedLocale = cookieLocale ?? headerLocale ?? defaultLocale;

  return {
    locale: resolvedLocale,
    timeZone: defaultTimeZone,
    messages: (await import(`../messages/${resolvedLocale}.json`)).default,
    getMessageFallback: createMessageFallback(resolvedLocale),
  };
});
