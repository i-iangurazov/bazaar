import {
  BazaarCatalogFontFamily,
  BazaarCatalogHeaderStyle,
  BazaarCatalogStatus,
} from "@prisma/client";

import { authenticatedE2EIds, authenticatedE2ESeedPrefix } from "./contract";

const catalogRecord = (input: {
  id: string;
  organizationId: string;
  storeId: string;
  slug: string;
  title: string;
  updatedById: string;
}) => ({
  ...input,
  publicUrlPath: `/c/${input.slug}`,
  status: BazaarCatalogStatus.DRAFT,
  accentColor: "#2a6be4",
  fontFamily: BazaarCatalogFontFamily.NotoSans,
  headerStyle: BazaarCatalogHeaderStyle.STANDARD,
});

export const authenticatedCatalogPublicationFixture = {
  primary: {
    ...catalogRecord({
      id: "qa_bazaar_catalog_publication_primary",
      organizationId: authenticatedE2EIds.primaryOrganization,
      storeId: authenticatedE2EIds.primaryStore,
      slug: "qa-bazaar-primary-catalog-2026",
      title: `${authenticatedE2ESeedPrefix} Catalog Draft`,
      updatedById: "qa_bazaar_auth_user_admin",
    }),
    publishedTitle: `${authenticatedE2ESeedPrefix} Public Catalog`,
    product: {
      id: "qa_bazaar_catalog_publication_product_primary",
      storeProductId: "qa_bazaar_catalog_publication_store_product_primary",
      sku: `${authenticatedE2ESeedPrefix}-CATALOG-PUBLIC-PRIMARY`,
      name: `${authenticatedE2ESeedPrefix} Catalog Public Product`,
      category: "000-QA-Catalog-Public",
      basePriceKgs: 432.1,
    },
  },
  foreign: {
    ...catalogRecord({
      id: "qa_bazaar_catalog_publication_foreign",
      organizationId: authenticatedE2EIds.secondOrganization,
      storeId: authenticatedE2EIds.secondTenantStore,
      slug: "qa-bazaar-foreign-catalog-2026",
      title: `${authenticatedE2ESeedPrefix} Foreign Catalog Draft`,
      updatedById: "qa_bazaar_auth_user_second_tenant_admin",
    }),
    attemptedTitle: `${authenticatedE2ESeedPrefix} Forbidden Foreign Catalog Mutation`,
    product: {
      id: "qa_bazaar_catalog_publication_product_foreign",
      storeProductId: "qa_bazaar_catalog_publication_store_product_foreign",
      sku: `${authenticatedE2ESeedPrefix}-CATALOG-PUBLIC-FOREIGN`,
      name: `${authenticatedE2ESeedPrefix} Foreign Catalog Secret Product`,
      category: "000-QA-Catalog-Foreign",
      basePriceKgs: 987.65,
    },
  },
  baseUnitId: authenticatedE2EIds.primaryUnit,
  foreignBaseUnitId: authenticatedE2EIds.secondTenantUnit,
} as const;

export const authenticatedCatalogPublicationRecords = [
  authenticatedCatalogPublicationFixture.primary,
  authenticatedCatalogPublicationFixture.foreign,
] as const;
