import { PublicCatalogPage } from "@/components/catalog/public-catalog-page";

type CatalogPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

const CatalogPage = async ({ params: paramsPromise }: CatalogPageProps) => {
  const params = await paramsPromise;

  return <PublicCatalogPage slug={params.slug} />;
};

export default CatalogPage;
