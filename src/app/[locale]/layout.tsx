import { notFound } from "next/navigation";

import { normalizeLocale } from "@/lib/locales";

const LocaleLayout = async ({
  children,
  params: paramsPromise,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) => {
  const params = await paramsPromise;

  if (!normalizeLocale(params.locale)) {
    notFound();
  }

  return children;
};

export default LocaleLayout;
