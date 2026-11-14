import { notFound } from "next/navigation";
import { SolutionsPage } from "@/components/marketing/SolutionsPage";
import { isLocale, locales } from "@/lib/locales";
import { getSolutionMetadata } from "@/lib/solutionsMetadata";

export const dynamicParams = false;
export const generateStaticParams = () => locales.map((locale) => ({ locale }));

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return getSolutionMetadata(locale);
}

export default async function SolutionsIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <SolutionsPage locale={locale} />;
}
