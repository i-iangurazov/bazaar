import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";

import { HelpGuidePage } from "@/components/help/HelpGuidePage";
import { getHelpGuide, helpGuides } from "@/content/help/catalog";
import { localize } from "@/content/help/ui";
import { defaultLocale, normalizeLocale } from "@/lib/locales";

export const generateStaticParams = () =>
  helpGuides.map((item) => ({ category: item.category, guide: item.slug }));

export const generateMetadata = async ({
  params,
}: {
  params: { category: string; guide: string };
}): Promise<Metadata> => {
  const item = getHelpGuide(params.category, params.guide);
  if (!item) return {};
  const locale = normalizeLocale(await getLocale()) ?? defaultLocale;
  const title = `${localize(item.title, locale)} — Bazaar Guide`;
  const description = localize(item.summary, locale);
  const url = `https://www.bazaar.kg/help/${item.category}/${item.slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "article" },
    robots: { index: true, follow: true },
  };
};

const GuidePage = ({
  params,
  searchParams,
}: {
  params: { category: string; guide: string };
  searchParams: { from?: string };
}) => {
  const item = getHelpGuide(params.category, params.guide);
  if (!item) notFound();
  const locale = defaultLocale;
  const url = `https://www.bazaar.kg/help/${item.category}/${item.slug}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: localize(item.title, locale),
    description: localize(item.summary, locale),
    totalTime: `PT${item.estimatedMinutes}M`,
    url,
    step: item.steps.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: localize(step.title, locale),
      text: localize(step.body, locale),
      url: `${url}#step-${index + 1}`,
    })),
  };
  const sourceRoute =
    typeof searchParams.from === "string" && searchParams.from.startsWith("/")
      ? searchParams.from.slice(0, 120)
      : undefined;
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <HelpGuidePage guide={item} sourceRoute={sourceRoute} />
    </>
  );
};

export default GuidePage;
