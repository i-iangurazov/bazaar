import { describe, expect, it } from "vitest";

import { getMarketingCopy } from "@/content/marketing";
import {
  getMarketingStructuredData,
  serializeMarketingStructuredData,
} from "@/lib/marketingStructuredData";
import { getPlanCatalogEntries } from "@/server/billing/planCatalog";

const actualOffers = getPlanCatalogEntries().map((plan) => ({
  name: plan.code,
  price: plan.monthlyPriceKgs,
}));

const build = (locale = "ru") =>
  getMarketingStructuredData({
    locale,
    description: getMarketingCopy(locale).meta.structuredDescription,
    offers: actualOffers,
  });

describe("marketing structured identity", () => {
  it("keeps one Latin brand and a linked website, publisher and application on the public domain", () => {
    const data = build();
    const website = data["@graph"].find((node) => node["@type"] === "WebSite")!;
    const organization = data["@graph"].find((node) => node["@type"] === "Organization")!;
    const application = data["@graph"].find((node) => node["@type"] === "SoftwareApplication")!;

    expect(data["@context"]).toBe("https://schema.org");
    expect(new Set(data["@graph"].map((node) => node["@id"])).size).toBe(3);
    expect(data["@graph"].every((node) => node.name === "BAZAAR")).toBe(true);
    expect(website).toMatchObject({
      "@id": "https://www.bazaar.kg/#website",
      url: "https://www.bazaar.kg/",
      alternateName: ["Базар", "bazaar.kg"],
      inLanguage: ["ru", "ky", "en"],
      publisher: { "@id": organization["@id"] },
      mainEntity: { "@id": application["@id"] },
    });
    expect(application).toMatchObject({
      publisher: { "@id": organization["@id"] },
      isPartOf: { "@id": website["@id"] },
    });
    expect(organization).toMatchObject({
      url: "https://www.bazaar.kg/",
      logo: { url: "https://www.bazaar.kg/brand/logo.png", width: 724, height: 181 },
      sameAs: ["https://www.instagram.com/bazaar.pos/"],
      contactPoint: { telephone: "+996709911300", email: "support@bazaar.kg" },
    });
  });

  it.each([
    ["ru", "ru", "/ru"],
    ["kg", "ky", "/kg"],
    ["ky", "ky", "/kg"],
    ["en", "en", "/en"],
    ["unrecognized", "ru", "/ru"],
  ])("uses the canonical public home and valid language for %s", (locale, language, path) => {
    const application = build(locale)["@graph"].find(
      (node) => node["@type"] === "SoftwareApplication",
    )!;
    expect(application).toMatchObject({
      url: `https://www.bazaar.kg${path}`,
      inLanguage: language,
      description: getMarketingCopy(locale).meta.structuredDescription,
    });
  });

  it("preserves the supplied real catalog prices and names in KGS without inventing free plans or ratings", () => {
    const application = build()["@graph"].find((node) => node["@type"] === "SoftwareApplication")!;
    expect(application.offers).toEqual(
      actualOffers.map(({ name, price }) => ({
        "@type": "Offer",
        name,
        price: String(price),
        priceCurrency: "KGS",
      })),
    );

    const supplied = [{ name: "Новичок", price: "2475" }];
    const applicationWithSuppliedPrice = getMarketingStructuredData({
      locale: "ru",
      description: "Описание",
      offers: supplied,
    })["@graph"].find((node) => node["@type"] === "SoftwareApplication")!;
    expect(applicationWithSuppliedPrice.offers).toEqual([
      { "@type": "Offer", name: "Новичок", price: "2475", priceCurrency: "KGS" },
    ]);
    expect(supplied).toEqual([{ name: "Новичок", price: "2475" }]);
    for (const node of build()["@graph"]) {
      expect(node).not.toHaveProperty("aggregateRating");
      expect(node).not.toHaveProperty("review");
      expect(node).not.toHaveProperty("address");
    }
  });

  it("serializes hostile HTML-like copy as safe JSON-LD while preserving its original text", () => {
    const description = 'BAZAAR «Базар» </script><script>alert("x")</script>\u2028строка\u2029';
    const data = getMarketingStructuredData({
      locale: "ru",
      description,
      offers: [{ name: "</script>Новичок", price: "2000" }],
    });
    const serialized = serializeMarketingStructuredData(data);
    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain("\u2028");
    expect(serialized).not.toContain("\u2029");
    expect(serialized).toContain("\\u003c/script>");
    expect(JSON.parse(serialized)).toEqual(data);
  });
});
