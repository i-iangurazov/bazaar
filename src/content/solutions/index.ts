import { defaultLocale, normalizeLocale, type Locale } from "@/lib/locales";
import type { SolutionsCopy } from "./types";
import ru from "./ru.json";
import kg from "./kg.json";
import en from "./en.json";

export type { SolutionContentId, SolutionPageCopy, SolutionsCopy } from "./types";

const copies: Record<Locale, SolutionsCopy> = { ru, kg, en };

export const getSolutionsCopy = (locale: string): SolutionsCopy =>
  copies[normalizeLocale(locale) ?? defaultLocale];
