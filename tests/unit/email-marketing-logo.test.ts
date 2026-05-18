import { EmailCampaignFontFamily, EmailCampaignTemplate } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildEmailUnsubscribeUrl,
  collectNonPublicEmailImageUrls,
  isPublicEmailMarketingAssetUrl,
  renderEmailCampaign,
  resolveEmailMarketingAssetUrl,
} from "@/server/services/emailMarketing";

const testStore = {
  id: "store-1",
  name: "Airport Store",
  legalName: null,
  address: null,
  phone: null,
  currencyCode: "KGS",
  currencyRateKgsPerUnit: 1,
  enableSku: true,
  enableBarcode: true,
  bazaarCatalog: null,
};

const testCampaign = {
  storeId: "store-1",
  name: "Sale",
  audience: { mode: "segment" as const, segment: "all" as const, source: "ALL" as const },
  template: EmailCampaignTemplate.CUSTOM,
  templateKey: "blank",
  subject: "Sale",
  preheader: null,
  senderDisplayName: null,
  replyToEmail: null,
  brandColor: "#111827",
  buttonColor: "#111827",
  buttonTextColor: "#ffffff",
  backgroundColor: "#f3f4f6",
  contentBackgroundColor: "#ffffff",
  textColor: "#111827",
  mutedTextColor: "#4b5563",
  borderColor: "#e5e7eb",
  fontFamily: EmailCampaignFontFamily.INTER,
  logoStoreId: null,
  blocks: [
    {
      id: "header",
      type: "header" as const,
      showStoreName: true,
      showLogo: true,
    },
    {
      id: "text",
      type: "text" as const,
      heading: "Sale",
      body: "Selected products are available.",
    },
    {
      id: "footer",
      type: "footer" as const,
      showUnsubscribe: true,
    },
  ],
  legacyBody: "Selected products are available.",
};

describe("email marketing logo rendering", () => {
  it("resolves relative managed logo URLs against the public app URL", () => {
    const previousNextAuthUrl = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = "https://app.bazaar.kg";

    try {
      expect(resolveEmailMarketingAssetUrl("/uploads/imported-products/org/logo.png")).toBe(
        "https://app.bazaar.kg/uploads/imported-products/org/logo.png",
      );
    } finally {
      if (previousNextAuthUrl === undefined) {
        delete process.env.NEXTAUTH_URL;
      } else {
        process.env.NEXTAUTH_URL = previousNextAuthUrl;
      }
    }
  });

  it("does not render relative image URLs when no public app URL exists", () => {
    const previousNextAuthUrl = process.env.NEXTAUTH_URL;
    const previousNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    const previousAppUrl = process.env.APP_URL;
    const previousVercelUrl = process.env.VERCEL_URL;
    delete process.env.NEXTAUTH_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.APP_URL;
    delete process.env.VERCEL_URL;

    try {
      expect(resolveEmailMarketingAssetUrl("/uploads/imported-products/org/logo.png")).toBeNull();
    } finally {
      if (previousNextAuthUrl === undefined) {
        delete process.env.NEXTAUTH_URL;
      } else {
        process.env.NEXTAUTH_URL = previousNextAuthUrl;
      }
      if (previousNextPublicAppUrl === undefined) {
        delete process.env.NEXT_PUBLIC_APP_URL;
      } else {
        process.env.NEXT_PUBLIC_APP_URL = previousNextPublicAppUrl;
      }
      if (previousAppUrl === undefined) {
        delete process.env.APP_URL;
      } else {
        process.env.APP_URL = previousAppUrl;
      }
      if (previousVercelUrl === undefined) {
        delete process.env.VERCEL_URL;
      } else {
        process.env.VERCEL_URL = previousVercelUrl;
      }
    }
  });

  it("falls back to store name instead of a broken image when no logo is selected", () => {
    const rendered = renderEmailCampaign({
      campaign: testCampaign,
      store: testStore,
      logoUrl: null,
    });

    expect(rendered.html).toContain("Airport Store");
    expect(rendered.html).not.toContain("<img src=");
  });

  it("renders unsubscribe links when provided", () => {
    const previousNextAuthSecret = process.env.NEXTAUTH_SECRET;
    process.env.NEXTAUTH_SECRET = "test-secret";

    try {
      const unsubscribeUrl = buildEmailUnsubscribeUrl({
        baseUrl: "https://app.bazaar.kg",
        customerId: "customer-1",
        email: "ONE@EXAMPLE.COM",
      });
      const rendered = renderEmailCampaign({
        campaign: testCampaign,
        store: testStore,
        logoUrl: null,
        unsubscribeUrl,
      });

      expect(unsubscribeUrl).toContain("email=one%40example.com");
      expect(rendered.html).toContain("Отписаться");
      expect(rendered.text).toContain(`Отписаться от рассылки: ${unsubscribeUrl}`);
    } finally {
      if (previousNextAuthSecret === undefined) {
        delete process.env.NEXTAUTH_SECRET;
      } else {
        process.env.NEXTAUTH_SECRET = previousNextAuthSecret;
      }
    }
  });

  it("renders selected logo and hero banner images in the shared email renderer", () => {
    const rendered = renderEmailCampaign({
      campaign: {
        ...testCampaign,
        blocks: [
          {
            id: "header",
            type: "header",
            showStoreName: true,
            showLogo: true,
          },
          {
            id: "hero",
            type: "hero",
            imageUrl: "https://cdn.bazaar.kg/email/banner.jpg",
            heading: "Новая коллекция",
            subtitle: "Посмотрите обновление магазина.",
          },
        ],
      },
      store: testStore,
      logoUrl: "https://cdn.bazaar.kg/email/logo.png",
    });

    expect(rendered.html).toContain('src="https://cdn.bazaar.kg/email/logo.png"');
    expect(rendered.html).toContain('src="https://cdn.bazaar.kg/email/banner.jpg"');
    expect(rendered.text).toContain("Новая коллекция");
  });

  it("flags localhost image URLs before test or final email send", () => {
    const campaign = {
      ...testCampaign,
      blocks: [
        {
          id: "header",
          type: "header" as const,
          showStoreName: true,
          showLogo: true,
        },
        {
          id: "hero",
          type: "hero" as const,
          imageUrl: "http://localhost:3000/uploads/banner.png",
          heading: "Banner",
        },
        {
          id: "products",
          type: "products" as const,
          productIds: ["product-1"],
          showImage: true,
        },
      ],
    };
    const productsById = new Map([
      [
        "product-1",
        {
          id: "product-1",
          name: "Case",
          description: null,
          imageUrl: "http://127.0.0.1:3000/uploads/product.png",
          priceKgs: 1000,
          priceText: "1 000 сом",
          currencyCode: "KGS",
          publicUrl: null,
        },
      ],
    ]);

    expect(isPublicEmailMarketingAssetUrl("https://cdn.bazaar.kg/image.png")).toBe(true);
    expect(isPublicEmailMarketingAssetUrl("http://localhost:3000/image.png")).toBe(false);
    expect(
      collectNonPublicEmailImageUrls({
        campaign,
        productsById,
        logoUrl: "http://localhost:3000/uploads/logo.png",
      }),
    ).toEqual([
      "http://localhost:3000/uploads/logo.png",
      "http://localhost:3000/uploads/banner.png",
      "http://127.0.0.1:3000/uploads/product.png",
    ]);
  });
});
