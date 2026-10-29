import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getMarketingCopy } from "@/content/marketing";

import { MarketingLanding } from "@/components/marketing/MarketingLanding";
import { getServerAuthToken } from "@/server/auth/token";

const siteUrl = "https://www.bazaar.kg";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const copy = getMarketingCopy(locale);
  const socialImage = `/marketing/social/${locale === "ky" ? "kg" : locale}.png?v=20261030`;
  return {
    metadataBase: new URL(siteUrl),
    title: copy.meta.title,
    description: copy.meta.description,
    alternates: { canonical: "/" },
    openGraph: {
      title: copy.meta.socialTitle,
      description: copy.meta.description,
      url: siteUrl,
      siteName: "Bazaar",
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
