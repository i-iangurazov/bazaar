import { notFound } from "next/navigation";

import { normalizeLocale } from "@/lib/locales";

const LocaleLayout = async ({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) => {
  const { locale } = await params;
  if (!normalizeLocale(locale)) {
    notFound();
  }

  return children;
};

export default LocaleLayout;
