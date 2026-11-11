import type { Metadata } from "next";
import { getLocale } from "next-intl/server";

import { HelpHome } from "@/components/help/HelpHome";
import { buildHelpHomeData } from "@/content/help/home-data";
import { defaultLocale, normalizeLocale } from "@/lib/locales";

const metadataCopy = {
  ru: {
    title: "BAZAAR Guide — помощь для магазина",
    description: "Короткие визуальные инструкции по кассе, товарам, складу, аналитике и интеграциям BAZAAR.",
    socialDescription: "Понятные визуальные инструкции для владельца, менеджера, кассира и кладовщика.",
  },
  kg: {
    title: "BAZAAR Guide — дүкөн үчүн жардам",
    description: "BAZAAR кассасы, товарлар, кампа, аналитика жана интеграциялар боюнча кыска көрсөтмөлөр.",
    socialDescription: "Дүкөн ээси, менеджер, кассир жана кампачы үчүн түшүнүктүү көрсөтмөлөр.",
  },
  en: {
    title: "BAZAAR Guide — help for your store",
    description: "Short visual guides to BAZAAR POS, products, inventory, analytics and integrations.",
    socialDescription: "Clear visual guides for store owners, managers, cashiers and warehouse staff.",
  },
};

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = normalizeLocale(await getLocale()) ?? defaultLocale;
  const copy = metadataCopy[locale];
  return {
    title: copy.title,
    description: copy.description,
    alternates: { canonical: "https://www.bazaar.kg/help" },
    openGraph: {
      title: "BAZAAR Guide",
      description: copy.socialDescription,
      url: "https://www.bazaar.kg/help",
      type: "website",
      images: [
        {
          url: "/marketing/captures/pos-desktop-wide.webp",
          width: 1440,
          height: 1000,
          alt: "BAZAAR Guide",
        },
      ],
    },
    robots: { index: true, follow: true },
  };
};

const HelpPage = async () => {
  const locale = normalizeLocale(await getLocale()) ?? defaultLocale;
  return <HelpHome locale={locale} data={buildHelpHomeData(locale)} />;
};

export default HelpPage;
