import type { Metadata } from "next";
import { getSolutionsCopy } from "@/content/solutions";
import { marketingSiteUrl } from "@/lib/marketingSeo";
import {
  marketingSolutionPath,
  marketingSolutionsLanguageAlternates,
  type SolutionId,
} from "@/lib/marketingSolutions";
import type { Locale } from "@/lib/locales";

export const getSolutionMetadata = (locale: Locale, id?: SolutionId): Metadata => {
  const page = getSolutionsCopy(locale).pages[id ?? "retail"];
  const canonical = marketingSolutionPath(locale, id);
  const image = `/marketing/social/${locale}.png?v=20261030`;
  return {
    metadataBase: new URL(marketingSiteUrl),
    title: { absolute: page.metaTitle },
    description: page.description,
    alternates: { canonical, languages: marketingSolutionsLanguageAlternates(id) },
    robots: { index: true, follow: true },
    openGraph: {
      title: page.metaTitle,
      description: page.description,
      url: `${marketingSiteUrl}${canonical}`,
      siteName: "BAZAAR",
      locale: locale === "kg" ? "ky_KG" : locale === "en" ? "en_US" : "ru_KG",
      type: id === "store-guide" ? "article" : "website",
      images: [{ url: image, width: 1200, height: 630, alt: page.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: page.metaTitle,
      description: page.description,
      images: [image],
    },
  };
};
