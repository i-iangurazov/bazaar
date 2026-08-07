import type { Metadata } from "next";
import { getLocale } from "next-intl/server";

import { HelpHome } from "@/components/help/HelpHome";
import { buildHelpHomeData } from "@/content/help/home-data";
import { defaultLocale, normalizeLocale } from "@/lib/locales";

export const metadata: Metadata = {
  title: "Bazaar Guide — помощь для магазина",
  description:
    "Короткие визуальные инструкции по кассе, товарам, складу, аналитике и интеграциям Bazaar.",
  alternates: { canonical: "https://www.bazaar.kg/help" },
  openGraph: {
    title: "Bazaar Guide",
    description: "Понятные визуальные инструкции для владельца, менеджера, кассира и кладовщика.",
    url: "https://www.bazaar.kg/help",
    type: "website",
    images: [
      {
        url: "/marketing/captures/pos-desktop.webp",
        width: 1440,
        height: 1000,
        alt: "Bazaar Guide",
      },
    ],
  },
  robots: { index: true, follow: true },
};

const HelpPage = async () => {
  const locale = normalizeLocale(await getLocale()) ?? defaultLocale;
  return <HelpHome locale={locale} data={buildHelpHomeData(locale)} />;
};

export default HelpPage;
