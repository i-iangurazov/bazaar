import { PublicCatalogPage } from "@/components/catalog/public-catalog-page";

type CatalogPageProps = {
  params: {
    slug: string;
  };
};

const CatalogPage = ({ params }: CatalogPageProps) => {
  return <PublicCatalogPage slug={params.slug} />;
};

export default CatalogPage;
