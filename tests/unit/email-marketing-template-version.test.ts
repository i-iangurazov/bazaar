import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailCampaignFontFamily, EmailCampaignTemplate, EmailCampaignType } from "@prisma/client";
import { renderEmailCampaign } from "@/server/services/emailMarketing";

vi.mock("@/server/db/prisma", () => ({ prisma: {} }));

const fixture = (): Parameters<typeof renderEmailCampaign>[0] => ({
  campaign: {
    id: null,
    storeId: "synthetic-store",
    campaignType: EmailCampaignType.MARKETING,
    senderIdentityId: null,
    name: "November collection",
    audience: { mode: "segment", segment: "all", source: "ALL" },
    template: EmailCampaignTemplate.CUSTOM,
    templateKey: "blank",
    subject: "Collection for {{customerName}}",
    preheader: "{{storeName}} — {{currentDate}} <special>",
    senderDisplayName: "Corner Market",
    replyToEmail: null,
    brandColor: "#7c3aed",
    buttonColor: "#0f766e",
    buttonTextColor: "#ffffff",
    backgroundColor: "#fef3c7",
    contentBackgroundColor: "#fff7ed",
    textColor: "#292524",
    mutedTextColor: "#57534e",
    borderColor: "#fed7aa",
    fontFamily: EmailCampaignFontFamily.ROBOTO,
    logoStoreId: null,
    blocks: [
      { id: "header", type: "header", showStoreName: true, showLogo: true },
      {
        id: "intro",
        type: "text",
        heading: "Hello {{customerName}}",
        body: "Collection from {{storeName}}. <script>unsafe</script>",
      },
      { id: "button", type: "button", text: "View collection", url: "/catalog" },
      {
        id: "products",
        type: "products",
        productIds: ["synthetic-product"],
        showImage: true,
        showPrice: true,
        showDescription: true,
        showButton: true,
      },
      { id: "footer", type: "footer", showUnsubscribe: true },
    ],
    legacyBody: "November collection",
  },
  store: {
    id: "synthetic-store",
    name: "Corner & Market",
    legalName: null,
    address: null,
    phone: null,
    currencyCode: "KGS",
    currencyRateKgsPerUnit: 1,
    enableSku: true,
    enableBarcode: true,
    bazaarCatalog: null,
  },
  productsById: new Map([
    [
      "synthetic-product",
      {
        id: "synthetic-product",
        name: "Coffee <Arabica>",
        description: "Fresh & roasted",
        imageUrl: "https://assets.example.invalid/coffee.png",
        priceKgs: 450,
        priceText: "450 сом",
        currencyCode: "KGS",
        publicUrl: "https://www.bazaar.kg/catalog/coffee",
      },
    ],
  ]),
  logoUrl: "https://assets.example.invalid/merchant-logo.png",
  unsubscribeUrl: "https://www.bazaar.kg/api/email-marketing/unsubscribe?token=synthetic",
  recipient: { name: "Aida & Co", email: "recipient@example.invalid" },
  baseUrl: "https://www.bazaar.kg",
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T12:00:00.000Z"));
  vi.stubEnv("EMAIL_LOGO_URL", "https://assets.example.invalid/bazaar-logo.png");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("No network in pure email tests"))),
  );
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("persisted marketing email rendering versions", () => {
  it("preserves the exact legacy HTML, whitespace, variables and plain text", () => {
    const legacy = renderEmailCampaign(fixture());
    expect(legacy).toMatchSnapshot();
    for (const contentVersion of [0, 1]) {
      const input = fixture();
      input.campaign.contentVersion = contentVersion;
      expect(renderEmailCampaign(input)).toEqual(legacy);
    }
    expect(legacy.html).not.toContain("data-bazaar-email-template");
  });

  it("uses the common v2 frame without replacing merchant blocks, colours, products or unsubscribe", () => {
    const input = fixture();
    const legacy = renderEmailCampaign(input);
    input.campaign.contentVersion = 2;
    const branded = renderEmailCampaign(input);

    expect(branded.html).toContain('data-bazaar-email-template="v1"');
    expect(branded.html.match(/data-bazaar-email-template/g)).toHaveLength(1);
    expect(branded.text).toBe(legacy.text);
    expect(
      branded.html.match(/src="https:\/\/assets\.example\.invalid\/merchant-logo\.png"/g),
    ).toHaveLength(1);
    expect(branded.html).not.toContain("bazaar-logo.png");
    expect(branded.html).toContain("Corner &amp; Market — 11.11.2026 &lt;special&gt;");
    expect(branded.html).toContain("Hello Aida &amp; Co");
    expect(branded.html).toContain("Coffee &lt;Arabica&gt;");
    expect(branded.html).toContain("Fresh &amp; roasted");
    expect(branded.html).toContain("450 сом");
    expect(branded.html).toContain('href="https://www.bazaar.kg/catalog/coffee"');
    expect(branded.html).toContain('href="https://www.bazaar.kg/catalog"');
    expect(branded.html).toContain(
      'href="https://www.bazaar.kg/api/email-marketing/unsubscribe?token=synthetic"',
    );
    expect(branded.html).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
    expect(branded.html).not.toContain("<script>");
    expect(branded.html).toContain("Roboto, Arial, Helvetica, sans-serif");
    for (const colour of [
      "#fef3c7",
      "#fff7ed",
      "#292524",
      "#57534e",
      "#fed7aa",
      "#7c3aed",
      "#0f766e",
    ]) {
      expect(branded.html).toContain(colour);
    }
    expect(branded.html).not.toContain("max-width:640px");
  });

  it("uses Bazaar's base logo when new content has no merchant header", () => {
    const input = fixture();
    input.campaign.contentVersion = 2;
    input.campaign.blocks = input.campaign.blocks.filter((block) => block.type !== "header");
    const branded = renderEmailCampaign(input);
    expect(branded.html).toContain('data-bazaar-email-template="v1"');
    expect(
      branded.html.match(/src="https:\/\/assets\.example\.invalid\/bazaar-logo\.png"/g),
    ).toHaveLength(1);
    expect(branded.html).not.toContain("merchant-logo.png");
    expect(branded.html).toContain("Coffee &lt;Arabica&gt;");
    expect(branded.text).toContain("Aida & Co");
  });
});

afterAll(() => {
  if (process.env.WRITE_SYNTHETIC_EMAIL_PREVIEWS !== "1") return;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T12:00:00.000Z"));
  try {
    const input = fixture();
    input.campaign.contentVersion = 2;
    input.logoUrl = "./logo.png";
    const product = input.productsById!.get("synthetic-product")!;
    input.productsById!.set(product.id, { ...product, imageUrl: "./logo.png" });
    const html = renderEmailCampaign(input).html;
    const directory = resolve(".local/qa/gopay-pilot-20261111/email-visual");
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, "marketing-v2.html"), html, { mode: 0o600 });
  } finally {
    vi.useRealTimers();
  }
});
