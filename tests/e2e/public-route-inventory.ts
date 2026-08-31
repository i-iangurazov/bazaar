import { helpCategories, helpGuides } from "../../src/content/help/catalog";

export type PublicCanonicalRouteDefinition = {
  pattern: string;
  concretePath: string;
};

const fixedPublicRoutes = [
  { pattern: "/", concretePath: "/" },
  { pattern: "/privacy", concretePath: "/privacy" },
  { pattern: "/legal", concretePath: "/legal" },
  { pattern: "/developers/bazaar-api", concretePath: "/developers/bazaar-api" },
  { pattern: "/login", concretePath: "/login" },
  { pattern: "/signup", concretePath: "/signup" },
  { pattern: "/invite", concretePath: "/invite" },
  { pattern: "/invite/{token}", concretePath: "/invite/bad" },
  { pattern: "/reset", concretePath: "/reset" },
  { pattern: "/reset/{token}", concretePath: "/reset/bad" },
  { pattern: "/verify/{token}", concretePath: "/verify/bad" },
  {
    pattern: "/register-business/{token}",
    concretePath: "/register-business/bad",
  },
  { pattern: "/c/{catalog-slug}", concretePath: "/c/bad" },
  { pattern: "/help", concretePath: "/help" },
] as const satisfies readonly PublicCanonicalRouteDefinition[];

/**
 * Current public application routes covered by the public browser matrix.
 *
 * The list intentionally includes the Orders and Customers Guide additions
 * made after the frozen 116-pattern audit. The reconciliation regression
 * treats the frozen audit as a required subset and prevents current routes
 * from being used to inflate its denominator.
 */
export const publicCanonicalRouteInventory: readonly PublicCanonicalRouteDefinition[] = [
  ...fixedPublicRoutes,
  ...helpCategories.map((category) => ({
    pattern: `/help/${category.slug}`,
    concretePath: `/help/${category.slug}`,
  })),
  ...helpGuides.map((guide) => ({
    pattern: `/help/${guide.category}/${guide.slug}`,
    concretePath: `/help/${guide.category}/${guide.slug}`,
  })),
];
