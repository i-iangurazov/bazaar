import "server-only";

import { cache } from "react";

import { getPublicBazaarCatalog } from "@/server/services/bazaarCatalog";

/** Request-scoped catalog read shared by metadata and the document route. */
export const getPublicCatalogRouteData = cache((slug: string) =>
  getPublicBazaarCatalog(slug, { page: 1, pageSize: 24 }),
);
