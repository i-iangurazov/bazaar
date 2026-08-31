import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { MarketingLanding } from "@/components/marketing/MarketingLanding";
import { normalizeLocale } from "@/lib/locales";
import { getServerAuthToken } from "@/server/auth/token";

const siteUrl = "https://www.bazaar.kg";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("landing");
  const locale = normalizeLocale(await getLocale()) ?? "ru";
  const openGraphLocale = { ru: "ru_KG", kg: "ky_KG", en: "en_US" }[locale];
  const title = t("meta.title");
  const description = t("meta.description");

  return {
    metadataBase: new URL(siteUrl),
    title,
    description,
    alternates: {
      canonical: "/",
    },
    openGraph: {
      title,
      description,
      url: siteUrl,
      siteName: "Bazaar",
      locale: openGraphLocale,
      type: "website",
      images: [
        {
          url: "/marketing/captures/dashboard-wide.webp",
          width: 1440,
          height: 900,
          alt: t("capabilities.reports.title"),
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/marketing/captures/dashboard-wide.webp"],
    },
    robots: {
      index: true,
      follow: true,
    },
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
