import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { MarketingLanding } from "@/components/marketing/MarketingLanding";
import { getServerAuthToken } from "@/server/auth/token";

const siteUrl = "https://www.bazaar.kg";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("marketing");
  const locale = await getLocale();
  return {
    metadataBase: new URL(siteUrl),
    title: { absolute: t("meta.title") },
    description: t("meta.description"),
    alternates: {
      canonical: "/",
    },
    openGraph: {
      title: t("meta.title"),
      description: t("meta.description"),
      url: siteUrl,
      siteName: "Bazaar",
      locale: locale === "en" ? "en_US" : locale === "kg" ? "ky_KG" : "ru_KG",
      type: "website",
      images: [
        {
          url: "/marketing/captures/dashboard-wide.webp",
          width: 1920,
          height: 1080,
          alt: t("showcase.reports.alt"),
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: t("meta.title"),
      description: t("meta.description"),
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
