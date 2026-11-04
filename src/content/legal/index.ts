import type { Locale } from "@/lib/locales";
import { ruLegal } from "./ru";
import { kgLegal } from "./kg";
import { enLegal } from "./en";
import type { LegalCopy } from "./types";

export const legalCopy: Record<Locale, LegalCopy> = {
  ru: ruLegal,
  kg: kgLegal,
  en: enLegal,
};
