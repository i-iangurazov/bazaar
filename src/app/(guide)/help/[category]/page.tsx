import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";

import { HelpCategoryPage } from "@/components/help/HelpCategoryPage";
import { getHelpCategory, helpCategories } from "@/content/help/catalog";
import { localize } from "@/content/help/ui";
import { defaultLocale, normalizeLocale } from "@/lib/locales";

export const generateStaticParams = () =>
  helpCategories.map((category) => ({ category: category.slug }));

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> => {
  const { category: categorySlug } = await params;
  const category = getHelpCategory(categorySlug);
  if (!category) return {};
  const locale = normalizeLocale(await getLocale()) ?? defaultLocale;
  const title = `${localize(category.title, locale)} — Bazaar Guide`;
  const description = localize(category.description, locale);
  return {
    title,
    description,
    alternates: { canonical: `https://www.bazaar.kg/help/${category.slug}` },
    openGraph: {
      title,
      description,
      url: `https://www.bazaar.kg/help/${category.slug}`,
      type: "website",
    },
  };
};

const CategoryPage = async ({ params }: { params: Promise<{ category: string }> }) => {
  const { category: categorySlug } = await params;
  const category = getHelpCategory(categorySlug);
  if (!category) notFound();
  return <HelpCategoryPage category={category} />;
};

export default CategoryPage;
