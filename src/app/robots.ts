import type { MetadataRoute } from "next";

const privateApplicationRoutes = [
  "/admin/",
  "/api/",
  "/billing",
  "/cash",
  "/customers",
  "/dashboard",
  "/finance/",
  "/inventory",
  "/onboarding",
  "/operations/",
  "/orders",
  "/platform",
  "/pos",
  "/products",
  "/purchase-orders",
  "/reports",
  "/sales/",
  "/settings/",
  "/stores",
  "/suppliers",
];

const robots = (): MetadataRoute.Robots => ({
  rules: {
    userAgent: "*",
    allow: ["/", "/c/", "/developers/bazaar-api", "/help", "/signup"],
    disallow: privateApplicationRoutes,
  },
  sitemap: "https://www.bazaar.kg/sitemap.xml",
  host: "https://www.bazaar.kg",
});

export default robots;
