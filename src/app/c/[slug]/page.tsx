import { notFound } from "next/navigation";

import { PublicCatalogPage } from "@/components/catalog/public-catalog-page";
import { getPublicCatalogRouteData } from "@/server/services/publicCatalogRoute";

type CatalogPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

const CatalogPage = async ({ params }: CatalogPageProps) => {
  const { slug } = await params;
  const catalog = await getPublicCatalogRouteData(slug);
  if (!catalog) {
    notFound();
  }
  return <PublicCatalogPage slug={slug} initialCatalog={catalog} />;
};

export default CatalogPage;
