import { EmailCampaignFontFamily, EmailCampaignTemplate, EmailCampaignType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildEmailUnsubscribeUrl,
  collectNonPublicEmailImageUrls,
  isPublicEmailMarketingAssetUrl,
  mapEmailSenderProviderError,
  renderEmailCampaign,
  resolveEmailMarketingAssetUrl,
  validateEmailSenderAddress,
} from "@/server/services/emailMarketing";
import { EmailProviderError } from "@/server/services/email";

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
  id: null,
  storeId: "store-1",
  campaignType: EmailCampaignType.MARKETING,
  senderIdentityId: null,
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
  it("validates branded Resend sender domains and rejects public mailbox domains", () => {
    expect(validateEmailSenderAddress("NEWS@Avantehnik.KG")).toEqual({
      fromEmail: "news@avantehnik.kg",
      domain: "avantehnik.kg",
    });

    expect(() => validateEmailSenderAddress("owner@gmail.com")).toThrow(
      "emailSenderPublicDomain",
    );
    expect(() => validateEmailSenderAddress("not-an-email")).toThrow(
      "emailSenderFromInvalid",
    );
  });

  it("maps Resend sender setup failures to user-facing error keys", () => {
    expect(
      mapEmailSenderProviderError(
        new EmailProviderError({
          provider: "resend",
          status: 401,
          responseText: '{"message":"Invalid API key"}',
          providerMessage: "Invalid API key",
        }),
      ).message,
    ).toBe("emailSenderProviderAuthFailed");

    expect(
      mapEmailSenderProviderError(
        new EmailProviderError({
          provider: "resend",
          status: 401,
          responseText: '{"name":"restricted_api_key","message":"This API key is restricted to only send emails"}',
          providerMessage: "This API key is restricted to only send emails",
        }),
      ).message,
    ).toBe("emailSenderProviderRestrictedKey");

    expect(
      mapEmailSenderProviderError(
        new EmailProviderError({
          provider: "resend",
          status: 409,
          responseText: '{"message":"Domain already exists"}',
          providerMessage: "Domain already exists",
        }),
      ).message,
    ).toBe("emailSenderDomainAlreadyExists");
  });

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

  it("escapes editor text and renders order variables safely", () => {
    const rendered = renderEmailCampaign({
      campaign: {
        ...testCampaign,
        blocks: [
          {
            id: "text",
            type: "text",
            heading: "Заказ {{orderNumber}}",
            body: "<script>alert(1)</script> Статус: {{orderStatus}}",
          },
	          {
	            id: "order",
	            type: "orderSummary",
	            title: "Order {{orderNumber}}",
	            summaryText: "Status changed from {{orderPreviousStatus}} to {{orderStatus}}",
	            itemsLabel: "Items",
	            totalLabel: "Total",
	            quantitySeparator: "x",
	            showItems: true,
	            showTotals: true,
	          },
        ],
      },
      store: testStore,
      logoUrl: null,
      order: {
	        number: "ORD-7",
	        previousStatus: "confirmed",
	        status: "готов",
	        totalText: "1 200 сом",
	        lines: [{ name: "Футболка <XL>", qty: 2, totalText: "1 200 сом" }],
	      },
	    });

	    expect(rendered.html).toContain("Заказ ORD-7");
	    expect(rendered.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
	    expect(rendered.html).toContain("Status changed from confirmed to");
	    expect(rendered.html).toContain("Items");
	    expect(rendered.html).toContain("Total: 1 200 сом");
	    expect(rendered.html).toContain("Футболка &lt;XL&gt;");
	    expect(rendered.text).toContain("Total: 1 200 сом");
	  });

  it("renders text formatting while escaping unsafe HTML", () => {
    const rendered = renderEmailCampaign({
      campaign: {
        ...testCampaign,
        blocks: [
          {
            id: "formatted-text",
            type: "text",
            heading: "Formatted",
            body: "Normal **bold <tag>** copy",
            bodyBold: true,
            bodyFontSize: "large",
          },
        ],
      },
      store: testStore,
      logoUrl: null,
    });

    expect(rendered.html).toContain("font-size:18px");
    expect(rendered.html).toContain("font-weight:700");
    expect(rendered.html).toContain("<strong>bold &lt;tag&gt;</strong>");
    expect(rendered.html).not.toContain("<tag>");
    expect(rendered.text).toContain("Normal **bold <tag>** copy");
  });

  it("renders persisted edited blocks and omits deleted block content", () => {
    const rendered = renderEmailCampaign({
      campaign: {
        ...testCampaign,
        blocks: [
          {
            id: "edited-text",
            type: "text",
            heading: "Persisted canvas heading",
            body: "Persisted inline body",
          },
          {
            id: "edited-button",
            type: "button",
            text: "Persisted CTA",
            url: "https://example.com/updated",
          },
          {
            id: "footer",
            type: "footer",
            showUnsubscribe: false,
            text: "Persisted footer",
          },
        ],
      },
      store: testStore,
      logoUrl: null,
    });

    expect(rendered.html).toContain("Persisted canvas heading");
    expect(rendered.html).toContain("Persisted inline body");
    expect(rendered.html).toContain("Persisted CTA");
    expect(rendered.html).not.toContain("Deleted block heading");
    expect(rendered.text).not.toContain("Deleted block heading");
  });

  it("renders saved block alignment in email-safe HTML", () => {
    const rendered = renderEmailCampaign({
      campaign: {
        ...testCampaign,
        blocks: [
          {
            id: "centered-header",
            type: "header",
            showStoreName: true,
            showLogo: true,
            heading: "Centered header",
            alignment: "center",
          },
          {
            id: "right-text",
            type: "text",
            heading: "Right heading",
            body: "Right body",
            alignment: "right",
          },
          {
            id: "center-button",
            type: "button",
            text: "Centered CTA",
            url: "https://example.com/cta",
            alignment: "center",
          },
        ],
      },
      store: testStore,
      logoUrl: "https://cdn.example.com/logo.png",
    });

    expect(rendered.html).toContain("text-align:center");
    expect(rendered.html).toContain("text-align:right");
    expect(rendered.html).toContain("margin:0 auto 8px");
    expect(rendered.html).toContain("Centered CTA");
  });

  it("respects product description visibility in product blocks", () => {
    const productsById = new Map([
      [
        "product-1",
        {
          id: "product-1",
          name: "Product with description",
          description: "Hidden product description",
          imageUrl: null,
          priceKgs: 1000,
          priceText: "1 000 сом",
          currencyCode: "KGS",
          publicUrl: null,
        },
      ],
    ]);
    const visible = renderEmailCampaign({
      campaign: {
        ...testCampaign,
        blocks: [
          {
            id: "products",
            type: "products",
            productIds: ["product-1"],
            showImage: false,
            showDescription: true,
            showPrice: true,
            showButton: false,
          },
        ],
      },
      store: testStore,
      logoUrl: null,
      productsById,
    });
    const hidden = renderEmailCampaign({
      campaign: {
        ...testCampaign,
        blocks: [
          {
            id: "products",
            type: "products",
            productIds: ["product-1"],
            showImage: false,
            showDescription: false,
            showPrice: true,
            showButton: false,
          },
        ],
      },
      store: testStore,
      logoUrl: null,
      productsById,
    });

    expect(visible.html).toContain("Hidden product description");
    expect(visible.text).toContain("Hidden product description");
    expect(hidden.html).not.toContain("Hidden product description");
    expect(hidden.text).not.toContain("Hidden product description");
  });

  it("renders different custom links for standalone email buttons", () => {
    const rendered = renderEmailCampaign({
      campaign: {
        ...testCampaign,
        blocks: [
          {
            id: "button-1",
            type: "button",
            text: "Shop now",
            url: "https://client.example.com",
          },
          {
            id: "button-2",
            type: "button",
            text: "Open sale",
            url: "https://client.example.com/sale",
          },
        ],
      },
      store: testStore,
      logoUrl: null,
    });

    expect(rendered.html).toContain('href="https://client.example.com/"');
    expect(rendered.html).toContain('href="https://client.example.com/sale"');
    expect(rendered.text).toContain("Shop now: https://client.example.com/");
    expect(rendered.text).toContain("Open sale: https://client.example.com/sale");
  });

  it("renders per-product custom CTA links in product blocks", () => {
    const productsById = new Map([
      [
        "product-1",
        {
          id: "product-1",
          name: "Product A",
          description: null,
          imageUrl: null,
          priceKgs: 1000,
          priceText: "1 000 сом",
          currencyCode: "KGS",
          publicUrl: "https://bazaar.kg/catalog/a",
        },
      ],
      [
        "product-2",
        {
          id: "product-2",
          name: "Product B",
          description: null,
          imageUrl: null,
          priceKgs: 2000,
          priceText: "2 000 сом",
          currencyCode: "KGS",
          publicUrl: "https://bazaar.kg/catalog/b",
        },
      ],
    ]);
    const rendered = renderEmailCampaign({
      campaign: {
        ...testCampaign,
        blocks: [
          {
            id: "products",
            type: "products",
            productIds: ["product-1", "product-2"],
            showImage: false,
            showDescription: false,
            showPrice: true,
            showButton: true,
            buttonText: "Подробнее",
            buttonUrl: "https://client.example.com/default",
            productButtonUrls: {
              "product-1": "https://client.example.com/product-a",
              "product-2": "https://client.example.com/sale/product-b",
            },
          },
        ],
      },
      store: testStore,
      logoUrl: null,
      productsById,
    });

    expect(rendered.html).toContain('href="https://client.example.com/product-a"');
    expect(rendered.html).toContain('href="https://client.example.com/sale/product-b"');
    expect(rendered.html).not.toContain("https://client.example.com/default");
    expect(rendered.html).not.toContain("https://bazaar.kg/catalog/a");
    expect(rendered.text).toContain("Подробнее: https://client.example.com/product-a");
    expect(rendered.text).toContain("Подробнее: https://client.example.com/sale/product-b");
  });

  it("does not replace an invalid product CTA override with a fallback URL", () => {
    const productsById = new Map([
      [
        "product-1",
        {
          id: "product-1",
          name: "Product A",
          description: null,
          imageUrl: null,
          priceKgs: 1000,
          priceText: "1 000 сом",
          currencyCode: "KGS",
          publicUrl: "https://bazaar.kg/catalog/a",
        },
      ],
    ]);
    const rendered = renderEmailCampaign({
      campaign: {
        ...testCampaign,
        blocks: [
          {
            id: "products",
            type: "products",
            productIds: ["product-1"],
            showImage: false,
            showDescription: false,
            showPrice: true,
            showButton: true,
            buttonText: "Подробнее",
            productButtonUrls: {
              "product-1": "javascript:alert(1)",
            },
          },
        ],
      },
      store: testStore,
      logoUrl: null,
      productsById,
    });

    expect(rendered.html).not.toContain("javascript:alert");
    expect(rendered.html).not.toContain("https://bazaar.kg/catalog/a");
    expect(rendered.text).not.toContain("https://bazaar.kg/catalog/a");
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
