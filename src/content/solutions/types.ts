import type { SolutionId } from "@/lib/marketingSolutions";

export type SolutionContentId = SolutionId | "retail";

export type SolutionPageCopy = {
  title: string;
  metaTitle: string;
  description: string;
  eyebrow: string;
  intro: string;
  sections: { title: string; body: string; items: string[] }[];
  workflow: { title: string; body: string }[];
  faq: { question: string; answer: string }[];
};

export type SolutionsCopy = {
  ui: Record<
    | "home"
    | "solutions"
    | "indexTitle"
    | "indexDescription"
    | "indexIntro"
    | "primaryCta"
    | "pricingLink"
    | "demoLabel"
    | "workflowTitle"
    | "faqTitle"
    | "relatedTitle"
    | "guidesTitle"
    | "planNote"
    | "backToSolutions"
    | "breadcrumbLabel"
    | "contentsLabel",
    string
  >;
  pages: Record<SolutionContentId, SolutionPageCopy>;
};
