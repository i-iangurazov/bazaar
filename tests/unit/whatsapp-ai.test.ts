import { afterEach, describe, expect, it, vi } from "vitest";
import {
  whatsappPeriod,
  whatsappWindowOpen,
  whatsappPackExpiresAt,
  whatsappRecipientCountry,
  whatsappProfileSchema,
  whatsappKnowledgeSchema,
  WHATSAPP_STYLES,
} from "@/lib/whatsapp-ai";
import {
  whatsappConfig,
  encryptWhatsAppSecret,
  decryptWhatsAppSecret,
  validWhatsAppWebhookSecret,
} from "@/server/whatsapp/config";
import { allowedWhatsAppMediaUrl, normalizeWhatsAppEvents } from "@/server/whatsapp/events";
import {
  allowedWhatsAppOnboardingUrl,
  configureGupshupWebhook,
  sendGupshupText,
  WhatsAppUnknownSend,
} from "@/server/whatsapp/gupshup";
import { renderWhatsAppAnswer, whatsappAnswerSchema } from "@/server/whatsapp/answer";
import type { WhatsAppOffer } from "@/server/whatsapp/catalog";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const ready = {
  WHATSAPP_AI_ENABLED: "1",
  WHATSAPP_PARTNER_APPROVED: "1",
  WHATSAPP_PRIVACY_APPROVED: "1",
  WHATSAPP_PARTNER_BILLING_CONFIRMED: "1",
  WHATSAPP_INBOUND_SPEND_CAP_CONFIRMED: "1",
  WHATSAPP_PILOT_APPROVED: "1",
  GUPSHUP_UNIVERSAL_TOKEN_EXPIRES_AT: new Date(Date.now() + 7 * 86400_000).toISOString(),
  GUPSHUP_UNIVERSAL_TOKEN: "synthetic-partner-token",
  DEEPSEEK_API_KEY: "synthetic-key",
  WHATSAPP_ENCRYPTION_KEY: "ab".repeat(32),
  WHATSAPP_PUBLIC_URL: "https://bazaar.kg",
};
const event = (message: object) => ({
  gs_app_id: "app-own",
  object: "whatsapp_business_account",
  entry: [{ changes: [{ field: "messages", value: { messages: [message] } }] }],
});
const msg = {
  id: "wamid-one",
  from: "996700000001",
  timestamp: "1794066000",
  type: "text",
  text: { body: "Тест" },
};

describe("WhatsApp commercial boundaries", () => {
  it("renews at midnight Bishkek, including the year boundary", () => {
    expect(whatsappPeriod(new Date("2026-12-31T17:59:59Z")).key).toBe("2026-12");
    expect(whatsappPeriod(new Date("2026-12-31T18:00:00Z"))).toEqual({
      key: "2027-01",
      startsAt: new Date("2026-12-31T18:00:00Z"),
      endsAt: new Date("2027-01-31T18:00:00Z"),
    });
  });
  it("closes the service window at exactly 24 hours and rejects future time", () => {
    const now = new Date("2026-11-07T10:00:00Z");
    expect(whatsappWindowOpen(new Date(now.getTime() - 86400_000 + 1), now)).toBe(true);
    expect(whatsappWindowOpen(new Date(now.getTime() - 86400_000), now)).toBe(false);
    expect(whatsappWindowOpen(new Date(now.getTime() + 1), now)).toBe(false);
    expect(whatsappWindowOpen(null, now)).toBe(false);
  });
  it("keeps purchased credits for 12 months and clamps leap day", () => {
    expect(whatsappPackExpiresAt(new Date("2028-02-29T12:10:00Z")).toISOString()).toBe(
      "2029-02-28T12:10:00.000Z",
    );
  });
  it.each([
    ["996700000001", "KG"],
    ["+996700000001", "KG"],
    ["79990000000", null],
    ["9961", null],
    ["", null],
  ])("country gate for %s", (phone, expected) => {
    expect(whatsappRecipientCountry(phone)).toBe(expected);
  });
  it("does not override a foreign phone using the contact country", () => {
    expect(whatsappRecipientCountry("79990000000", "KG")).toBeNull();
    expect(whatsappRecipientCountry(null, "KG")).toBe("KG");
  });
  it("is disabled by default and distinguishes onboarding from the live pilot", () => {
    expect(whatsappConfig({}).ready).toBe(false);
    expect(whatsappConfig(ready).ready).toBe(true);
    expect(whatsappConfig({ ...ready, WHATSAPP_PILOT_APPROVED: "0" })).toMatchObject({
      ready: false,
      transportReady: true,
    });
  });
  it.each(Object.keys(ready))("fails closed without %s", (key) => {
    const config = whatsappConfig({ ...ready, [key]: undefined });
    expect(key.startsWith("GUPSHUP_") ? config.onboardingReady : config.ready).toBe(false);
  });
  it.each(["NaN", "0", "-1", "Infinity", "0.5"])("rejects invalid budget %s", (value) => {
    expect(whatsappConfig({ ...ready, WHATSAPP_DAILY_BUDGET_USD_MICROS: value }).ready).toBe(false);
  });
  it("never uses an authentication secret as an encryption key", () => {
    vi.stubEnv("WHATSAPP_ENCRYPTION_KEY", "");
    vi.stubEnv("NEXTAUTH_SECRET", "a".repeat(64));
    expect(() => encryptWhatsAppSecret("secret", "store-A")).toThrow("whatsappNotReady");
  });
  it("authenticates scope, detects tampering and supports controlled key rotation", () => {
    vi.stubEnv("WHATSAPP_ENCRYPTION_KEY", ready.WHATSAPP_ENCRYPTION_KEY);
    const encrypted = encryptWhatsAppSecret("synthetic-sensitive-value", "tenant-A");
    expect(encrypted).not.toContain("synthetic-sensitive");
    expect(() => decryptWhatsAppSecret(encrypted, "tenant-B")).toThrow("whatsappReconnectRequired");
    expect(() => decryptWhatsAppSecret(encrypted.slice(0, -5) + "xxxxx", "tenant-A")).toThrow();
    vi.stubEnv("WHATSAPP_ENCRYPTION_KEY", "cd".repeat(32));
    vi.stubEnv("WHATSAPP_PREVIOUS_ENCRYPTION_KEYS", ready.WHATSAPP_ENCRYPTION_KEY);
    expect(decryptWhatsAppSecret(encrypted, "tenant-A")).toBe("synthetic-sensitive-value");
  });
});

describe("WhatsApp ingress and provider transport", () => {
  it("requires an exact constant-time webhook secret", () => {
    expect(validWhatsAppWebhookSecret("a".repeat(64), "a".repeat(64))).toBe(true);
    expect(validWhatsAppWebhookSecret("a".repeat(63), "a".repeat(64))).toBe(false);
    expect(validWhatsAppWebhookSecret(null, "a".repeat(64))).toBe(false);
  });
  it("checks app ownership, timestamp and stable replay keys", () => {
    expect(() => normalizeWhatsAppEvents(event(msg), "another-app")).toThrow();
    expect(() =>
      normalizeWhatsAppEvents(event({ ...msg, timestamp: undefined }), "app-own"),
    ).toThrow();
    const a = normalizeWhatsAppEvents(event(msg), "app-own");
    expect(a[0]).toMatchObject({
      phone: "996700000001",
      identity: "996700000001",
      body: "Тест",
      kind: "MESSAGE",
    });
    expect(a[0].key).toBe(normalizeWhatsAppEvents(event(msg), "app-own")[0].key);
  });
  it("ignores synchronized historical messages", () => {
    const input = event(msg);
    input.entry[0].changes[0].field = "history";
    expect(normalizeWhatsAppEvents(input, "app-own")).toEqual([]);
  });
  it("binds contact profiles to each sender, including BSUID-only customers", () => {
    const input = {
      gs_app_id: "app-own",
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                contacts: [
                  { wa_id: "79990000000", profile: { name: "Other customer", country_code: "RU" } },
                  { user_id: "BSUID-ONE", profile: { name: "Buyer", country_code: "KG" } },
                ],
                messages: [{ ...msg, from: "BSUID-ONE" }],
              },
            },
          ],
        },
      ],
    };
    expect(normalizeWhatsAppEvents(input, "app-own")[0]).toMatchObject({
      identity: "BSUID-ONE",
      bsuid: "BSUID-ONE",
      name: "Buyer",
      country: "KG",
    });
    expect(normalizeWhatsAppEvents(input, "app-own")[0].phone).toBeUndefined();
  });
  it.each([
    "http://filemanager.gupshup.io/a",
    "https://filemanager.gupshup.io.evil.test/a",
    "https://127.0.0.1/a",
    "https://filemanager.gupshup.io@evil.test/a",
    "https://media.gupshup.io:444/a",
  ])("blocks untrusted media %s", (url) => {
    expect(allowedWhatsAppMediaUrl(url)).toBe(false);
  });
  it("accepts only official HTTPS onboarding hosts", () => {
    expect(allowedWhatsAppOnboardingUrl("https://onboarding.gupshup.io/path")).toBe(true);
    expect(allowedWhatsAppOnboardingUrl("https://gupshup.io.evil.test/path")).toBe(false);
  });
  it("updates its existing webhook instead of creating duplicates", async () => {
    vi.stubEnv("HARDENING_EXTERNAL_PROVIDER_MODE", "sandbox");
    vi.stubEnv("WHATSAPP_PUBLIC_URL", "https://bazaar.kg");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          status: "success",
          subscriptions: [{ id: "42", tag: "BazaarWhatsAppAI" }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ status: "success", subscription: { id: "42", active: true } }),
      );
    vi.stubGlobal("fetch", fetcher);
    await configureGupshupWebhook("app-own", "synthetic-token", "connection-own", "a".repeat(64));
    expect(fetcher.mock.calls[1][0]).toBe(
      "https://partner.gupshup.io/partner/app/app-own/subscription/42",
    );
    expect(fetcher.mock.calls[1][1].method).toBe("PUT");
    expect(fetcher.mock.calls[1][1].body.get("meta")).toBe(
      JSON.stringify({ "X-Gupshup-Webhook-Secret": "a".repeat(64) }),
    );
  });
  it("treats a network timeout as unknown, without a second send", async () => {
    vi.stubEnv("HARDENING_EXTERNAL_PROVIDER_MODE", "sandbox");
    const fetcher = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      sendGupshupText({
        appId: "app-own",
        token: "synthetic-token",
        phone: "996700000001",
        bsuid: null,
        body: "Тест",
        messageId: "message-own",
      }),
    ).rejects.toBeInstanceOf(WhatsAppUnknownSend);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("Customer answers preserve authoritative facts", () => {
  const offer: WhatsAppOffer = {
    ref: "product:BASE",
    productId: "product",
    variantId: null,
    name: "Синтетический товар",
    variant: null,
    price: "125.50",
    currency: "KGS",
    available: true,
    quantity: 2,
    unit: "шт",
    link: "/c/example?product=product",
    image: null,
  };
  const render = (raw: object, profile = {}) =>
    renderWhatsAppAnswer({
      answer: whatsappAnswerSchema.parse({ language: "ru", intent: "products", ...raw }),
      profile: whatsappProfileSchema.parse(profile),
      knowledge: whatsappKnowledgeSchema.parse({ storeName: "Test" }),
      offers: [offer],
      firstReply: false,
      origin: "https://bazaar.kg",
    });
  it.each(["ru", "kg", "en"])(
    "renders exact facts and navigable public links in %s",
    (language) => {
      const result = render({ language, offerRefs: [offer.ref] });
      expect(result.body).toContain("125.50 KGS");
      expect(result.body).toContain("https://bazaar.kg/c/example?product=product");
      expect(result.needsHuman).toBe(false);
    },
  );
  it("rejects fabricated prices, references and hidden financial claims", () => {
    expect(() => render({ offerRefs: ["foreign:BASE"] })).toThrow();
    expect(render({ offerRefs: [offer.ref], socialText: "Цена 100 сом" }).body).not.toContain(
      "100 сом",
    );
    expect(render({ offerRefs: [offer.ref], question: "Скидка 30%?" }).body).not.toContain("30%");
  });
  it("does not confirm an order, payment or reservation", () => {
    const result = render({ intent: "order" });
    expect(result.body).toContain("не зарезервирован");
    expect(result.body).toContain("оплата не подтверждена");
    expect(result.needsHuman).toBe(true);
  });
  it.each(WHATSAPP_STYLES)("supports %s without changing factual prices", (style) => {
    expect(
      render(
        { offerRefs: [offer.ref], socialText: "Помогу подобрать подходящий вариант." },
        { style },
      ).body,
    ).toContain("125.50 KGS");
  });
  it("uses the configured farewell instead of ignoring the field", () => {
    expect(render({ intent: "farewell" }, { farewell: "Спасибо, до встречи!" }).body).toBe(
      "Спасибо, до встречи!",
    );
  });
  it("normalizes the ISO Kyrgyz alias instead of rejecting a useful response", () => {
    expect(whatsappAnswerSchema.parse({ language: "ky", intent: "greeting" }).language).toBe("kg");
  });
  it("does not replace a filtered empty reply with an introduction alone", () => {
    const result = renderWhatsAppAnswer({
      answer: whatsappAnswerSchema.parse({
        language: "ru",
        intent: "knowledge",
        socialText: "Цена 100 сом",
      }),
      profile: whatsappProfileSchema.parse({}),
      knowledge: whatsappKnowledgeSchema.parse({ storeName: "Test" }),
      offers: [],
      firstReply: true,
      origin: "https://bazaar.kg",
    });
    expect(result.needsHuman).toBe(true);
    expect(result.body).not.toContain("100 сом");
    expect(result.body).toContain("не подтверждена");
  });
});
