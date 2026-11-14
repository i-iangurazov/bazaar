import { notFound } from "next/navigation";
import { SolutionsPage } from "@/components/marketing/SolutionsPage";
import { getSolutionBySlug, solutionPages } from "@/lib/marketingSolutions";
import { isLocale, locales } from "@/lib/locales";
import { getSolutionMetadata } from "@/lib/solutionsMetadata";

type Params = { locale: string; slug: string };
export const dynamicParams = false;
export const generateStaticParams = () =>
  locales.flatMap((locale) => solutionPages.map(({ slug }) => ({ locale, slug })));

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  const page = getSolutionBySlug(slug);
  if (!isLocale(locale) || !page) notFound();
  return getSolutionMetadata(locale, page.id);
}

export default async function SolutionDetail({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  const page = getSolutionBySlug(slug);
  if (!isLocale(locale) || !page) notFound();
  return <SolutionsPage locale={locale} id={page.id} />;
}
