import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { RouteIntlProvider } from "@/components/route-intl-provider";
import { getPublicCatalogRouteData } from "@/server/services/publicCatalogRoute";

type PublicCatalogLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

export const generateMetadata = async ({ params }: PublicCatalogLayoutProps): Promise<Metadata> => {
  const { slug } = await params;
  const catalog = await getPublicCatalogRouteData(slug);
  const t = await getTranslations("catalogPublic");
  if (!catalog) {
    return {
      title: t("notFoundTitle"),
      description: t("notFoundDescription"),
      robots: { index: false, follow: false },
    };
  }
  return {
    title: catalog.title,
    description: t("metaDescription", { store: catalog.storeName }),
  };
};

const PublicCatalogLayout = ({ children }: PublicCatalogLayoutProps) => (
  <RouteIntlProvider namespaces={["catalogPublic", "common", "errors"]}>
    {children}
  </RouteIntlProvider>
);

export default PublicCatalogLayout;
