import type { MetadataRoute } from "next";

import { helpCategories, helpGuides } from "@/content/help/catalog";
import { marketingCanonicalHomes, marketingLanguageAlternates } from "@/lib/marketingSeo";
import { locales } from "@/lib/locales";
import {
  marketingSolutionPath,
  marketingSolutionsLanguageAlternates,
  solutionPages,
} from "@/lib/marketingSolutions";

const sitemap = (): MetadataRoute.Sitemap => [
  ...locales.flatMap((locale) => [
    {
      url: `https://www.bazaar.kg${marketingSolutionPath(locale)}`,
      changeFrequency: "monthly" as const,
      priority: 0.8,
      alternates: { languages: marketingSolutionsLanguageAlternates() },
    },
    ...solutionPages.map(({ id }) => ({
      url: `https://www.bazaar.kg${marketingSolutionPath(locale, id)}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
      alternates: { languages: marketingSolutionsLanguageAlternates(id) },
    })),
  ]),
  ...marketingCanonicalHomes.map(({ url }) => ({
    url,
    changeFrequency: "weekly" as const,
    priority: 1,
    alternates: { languages: marketingLanguageAlternates },
  })),
  {
    url: "https://www.bazaar.kg/signup",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    url: "https://www.bazaar.kg/developers/bazaar-api",
    changeFrequency: "monthly",
    priority: 0.6,
  },
  {
    url: "https://www.bazaar.kg/privacy",
    changeFrequency: "monthly",
    priority: 0.3,
  },
  {
    url: "https://www.bazaar.kg/help",
    changeFrequency: "weekly",
    priority: 0.8,
  },
  ...helpCategories.map((category) => ({
    url: `https://www.bazaar.kg/help/${category.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.65,
  })),
  ...helpGuides.map((guide) => ({
    url: `https://www.bazaar.kg/help/${guide.category}/${guide.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  })),
];

export default sitemap;
