import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getMarketingCopy } from "@/content/marketing";

import { MarketingLanding } from "@/components/marketing/MarketingLanding";
import { getServerAuthToken } from "@/server/auth/token";
import { marketingHomePath, marketingLanguageAlternates, marketingSiteUrl } from "@/lib/marketingSeo";
import { defaultLocale, normalizeLocale } from "@/lib/locales";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = normalizeLocale(await getLocale()) ?? defaultLocale;
  const copy = getMarketingCopy(locale);
  const socialImage = `/marketing/social/${locale}.png?v=20261030`;
  const canonical = marketingHomePath(locale);
  return {
    metadataBase: new URL(marketingSiteUrl),
    title: { absolute: copy.meta.title },
    description: copy.meta.description,
    alternates: { canonical, languages: marketingLanguageAlternates },
    openGraph: {
      title: copy.meta.socialTitle,
      description: copy.meta.description,
      url: `${marketingSiteUrl}${canonical}`,
      siteName: "BAZAAR",
      locale: locale === "kg" ? "ky_KG" : locale === "en" ? "en_US" : "ru_KG",
      type: "website",
      images: [{ url: socialImage, width: 1200, height: 630, alt: copy.meta.imageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title: copy.meta.title,
      description: copy.meta.description,
      images: [socialImage],
    },
    robots: { index: true, follow: true },
  };
};

const RootPage = async () => {
  const token = await getServerAuthToken();
  if (token) {
    redirect("/dashboard");
  }

  return <MarketingLanding />;
};

export default RootPage;
