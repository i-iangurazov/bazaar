import type { MetadataRoute } from "next";

const sitemap = (): MetadataRoute.Sitemap => [
  {
    url: "https://www.bazaar.kg/",
    changeFrequency: "weekly",
    priority: 1,
  },
  {
    url: "https://www.bazaar.kg/signup",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    url: "https://www.bazaar.kg/developers/bazaar-api",
    changeFrequency: "monthly",
    priority: 0.6,
  },
];

export default sitemap;
