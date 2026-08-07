import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MarketingLanding } from "@/components/marketing/MarketingLanding";
import { getServerAuthToken } from "@/server/auth/token";

const siteUrl = "https://www.bazaar.kg";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Bazaar — Retail OS для современного магазина",
  description:
    "Bazaar объединяет кассу, товары, остатки, клиентов, аналитику, маркетплейсы, Bazaar API и мобильную работу в одной retail-системе.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Bazaar — весь ваш магазин в одной системе",
    description:
      "Продажи, товары, остатки, клиенты, интернет-магазины и аналитика синхронизированы в реальном времени.",
    url: siteUrl,
    siteName: "Bazaar",
    locale: "ru_KG",
    type: "website",
    images: [
      {
        url: "/marketing/captures/dashboard.webp",
        width: 1440,
        height: 900,
        alt: "Рабочая панель Bazaar Retail OS",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Bazaar — Retail OS для современного магазина",
    description: "Касса, запасы, товары, клиенты, commerce и аналитика в одной системе.",
    images: ["/marketing/captures/dashboard.webp"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

const RootPage = async () => {
  const token = await getServerAuthToken();
  if (token) {
    redirect("/dashboard");
  }

  return <MarketingLanding />;
};

export default RootPage;
