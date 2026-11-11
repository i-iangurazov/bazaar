import type { MetadataRoute } from "next";

const privateApplicationRoutes = [
  "/admin/",
  "/api/",
  "/baam",
  "/billing",
  "/cash",
  "/customers",
  "/dashboard",
  "/dev/",
  "/finance/",
  "/inventory",
  "/help/compliance",
  "/invite",
  "/loyalty/",
  "/onboarding",
  "/operations/",
  "/orders",
  "/platform",
  "/pos",
  "/products",
  "/purchase-orders",
  "/reports",
  "/register-business/",
  "/reset/",
  "/sales/",
  "/settings/",
  "/stores",
  "/suppliers",
  "/verify/",
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
