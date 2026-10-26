import { defaultLocale, normalizeLocale, type Locale } from "@/lib/locales";
import ru from "./ru.json";
import kg from "./kg.json";
import en from "./en.json";

export type MarketingCopy = typeof ru;
export type MarketingFeatureId = keyof MarketingCopy["features"];
const copies: Record<Locale, MarketingCopy> = { ru, kg, en };

/** Select on the server; client islands receive only the displayed copy. */
export const getMarketingCopy = (locale: string): MarketingCopy =>
  copies[normalizeLocale(locale) ?? defaultLocale];
