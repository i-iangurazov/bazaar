import { EmailCampaignFontFamily, EmailCampaignTemplate } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildEmailUnsubscribeUrl,
  renderEmailCampaign,
  resolveEmailMarketingAssetUrl,
} from "@/server/services/emailMarketing";

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
      campaign: {
        storeId: "store-1",
        source: "ALL",
        template: EmailCampaignTemplate.CUSTOM,
        subject: "Sale",
        preheader: null,
        heading: "Sale",
        body: "Selected products are available.",
        ctaLabel: null,
        ctaUrl: null,
        footerText: null,
        senderDisplayName: null,
        replyToEmail: null,
        brandColor: "#111827",
        buttonColor: "#111827",
        fontFamily: EmailCampaignFontFamily.INTER,
        bannerImageUrl: null,
        logoStoreId: null,
      },
      storeName: "Airport Store",
      logoUrl: null,
    });

    expect(rendered.html).toContain("Airport Store");
    expect(rendered.html).toContain("<strong");
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
        campaign: {
          storeId: "store-1",
          source: "ALL",
          template: EmailCampaignTemplate.CUSTOM,
          subject: "Sale",
          preheader: null,
          heading: "Sale",
          body: "Selected products are available.",
          ctaLabel: null,
          ctaUrl: null,
          footerText: null,
          senderDisplayName: null,
          replyToEmail: null,
          brandColor: "#111827",
          buttonColor: "#111827",
          fontFamily: EmailCampaignFontFamily.INTER,
          bannerImageUrl: null,
          logoStoreId: null,
        },
        storeName: "Airport Store",
        logoUrl: null,
        unsubscribeUrl,
      });

      expect(unsubscribeUrl).toContain("email=one%40example.com");
      expect(rendered.html).toContain("Unsubscribe");
      expect(rendered.text).toContain(`Unsubscribe: ${unsubscribeUrl}`);
    } finally {
      if (previousNextAuthSecret === undefined) {
        delete process.env.NEXTAUTH_SECRET;
      } else {
        process.env.NEXTAUTH_SECRET = previousNextAuthSecret;
      }
    }
  });
});
