import type { Locale } from "@/lib/locales";

export type HelpLocale = Locale;

export type LocalizedText = Record<HelpLocale, string>;

export type HelpCategorySlug =
  | "getting-started"
  | "pos"
  | "products"
  | "inventory"
  | "orders"
  | "customers"
  | "reports"
  | "integrations"
  | "settings";

export type HelpRole = "owner" | "manager" | "cashier" | "stockkeeper";

export type HelpAnnotation = {
  number: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  label: LocalizedText;
};

export type HelpMedia = {
  src: string;
  mobileSrc?: string;
  alt: LocalizedText;
  annotations: HelpAnnotation[];
};

export type HelpStepGuidance = {
  location: LocalizedText;
  control: LocalizedText;
  result: LocalizedText;
};

export type HelpStep = {
  title: LocalizedText;
  body: LocalizedText;
  guidance?: HelpStepGuidance;
  checklist?: LocalizedText[];
  note?: LocalizedText;
  media?: HelpMedia;
};

export type HelpTroubleshootingItem = {
  question: LocalizedText;
  answer: LocalizedText;
};

export type HelpGuide = {
  slug: string;
  category: HelpCategorySlug;
  title: LocalizedText;
  summary: LocalizedText;
  keywords: LocalizedText;
  aliases: LocalizedText;
  roles: HelpRole[];
  estimatedMinutes: number;
  steps: HelpStep[];
  success: LocalizedText;
  relatedGuides: string[];
  appRoute: string;
  troubleshooting?: HelpTroubleshootingItem[];
};

export type HelpCategory = {
  slug: HelpCategorySlug;
  title: LocalizedText;
  description: LocalizedText;
  icon: string;
};

export type HelpTask = {
  title: LocalizedText;
  description: LocalizedText;
  guideId: string;
  icon: string;
};

export type HelpJourneyItem = {
  title: LocalizedText;
  description: LocalizedText;
  guideId: string;
  estimatedMinutes: number;
};

export type HelpRoleTrack = {
  role: HelpRole;
  title: LocalizedText;
  description: LocalizedText;
  guideIds: string[];
};
