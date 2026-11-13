import type { MetadataRoute } from "next";

import { helpCategories, helpGuides } from "@/content/help/catalog";
import { marketingCanonicalHomes, marketingLanguageAlternates } from "@/lib/marketingSeo";

const sitemap = (): MetadataRoute.Sitemap => [
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
