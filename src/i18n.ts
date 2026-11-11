import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { defaultLocale, getLocaleFromAcceptLanguage, normalizeLocale } from "@/lib/locales";
import { defaultTimeZone } from "@/lib/timezone";
import { createMessageFallback } from "@/lib/i18nFallback";
import { marketingLocaleHeader } from "@/lib/marketingSeo";

export default getRequestConfig(async () => {
  const cookieLocale = normalizeLocale((await cookies()).get("NEXT_LOCALE")?.value);
  const requestHeaders = await headers();
  const marketingLocale = normalizeLocale(requestHeaders.get(marketingLocaleHeader));
  const headerLocale = getLocaleFromAcceptLanguage(requestHeaders.get("accept-language"));
  const resolvedLocale = marketingLocale ?? cookieLocale ?? headerLocale ?? defaultLocale;

  return {
    locale: resolvedLocale,
    timeZone: defaultTimeZone,
    messages: (await import(`../messages/${resolvedLocale}.json`)).default,
    getMessageFallback: createMessageFallback(resolvedLocale),
  };
});
