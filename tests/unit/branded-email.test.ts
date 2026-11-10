// @vitest-environment jsdom

import { resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const forbidden = vi.hoisted(() => ({
  database: vi.fn(() => {
    throw new Error("Database is forbidden in email template tests");
  }),
  send: vi.fn(() => {
    throw new Error("Sending is forbidden in email template tests");
  }),
}));
vi.mock("@/server/db/prisma", () => ({
  prisma: new Proxy({}, { get: () => forbidden.database }),
}));
vi.mock("@/server/middleware/rateLimiter", () => ({
  createRateLimiter: () => ({ consume: forbidden.database }),
}));
vi.mock("@/server/services/emailMarketing", () => ({
  resolveStorePrimaryVerifiedSender: forbidden.database,
}));

import {
  escapeEmailHtml,
  getEmailLogoUrl,
  renderBrandedEmail,
  renderEmailButton,
} from "@/server/services/emailTemplate";
import { buildInviteEmail, buildResetEmail, buildVerificationEmail } from "@/server/services/email";
import { buildLoyaltyOtpEmail } from "@/server/services/loyalty/memberAuth";
import { buildOrderEmailPayload } from "@/server/services/orderEmails";
import { subscriptionPaymentNotificationContent } from "@/server/billing/paymentNotificationContent";
import { subscriptionReminderContent } from "@/server/billing/reminderContent";
import {
  createSyntheticAccountEmails,
  createSyntheticEmailGallery,
  createSyntheticOrderEmailRecord,
  orderEmailFamilies,
  syntheticActionUrl,
  syntheticEmailDate,
  syntheticEmailEnd,
  syntheticEmailRecipient,
  syntheticOrganizationName,
} from "../helpers/transactionalEmailFixture";
import { writeSyntheticEmailPreview } from "../helpers/writeSyntheticEmailPreview";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const frame = '[data-bazaar-email-template="v1"]';
const hasWordWrapping = (element: Element | null): boolean => {
  for (let current = element; current; current = current.parentElement) {
    const style = (current as HTMLElement).style;
    if (
      style &&
      (["anywhere", "break-word"].includes(style.overflowWrap) ||
        ["break-all", "break-word"].includes(style.wordBreak) ||
        style.wordWrap === "break-word")
    )
      return true;
  }
  return false;
};
const assertSafeDocument = (doc: Document, locale: "ru" | "kg" | "en") => {
  expect(doc.documentElement.lang).toBe(locale === "kg" ? "ky" : locale);
  expect(doc.querySelectorAll(frame)).toHaveLength(1);
  expect(doc.querySelector(frame)?.tagName).toBe("TABLE");
  expect(doc.querySelector(frame)?.getAttribute("role")).toBe("presentation");
  expect(doc.querySelectorAll("html")).toHaveLength(1);
  expect(doc.querySelectorAll("body")).toHaveLength(1);
  expect(doc.querySelector('meta[name="viewport"]')?.getAttribute("content")).toContain(
    "width=device-width",
  );
  expect(doc.querySelector("script,[onerror],[onmouseover],[onclick],iframe")).toBeNull();
  expect(doc.body.textContent).not.toMatch(
    /undefined|Invalid Date|\{(organization|date|amount|plan)\}/,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", forbidden.send);
  vi.stubEnv("NEXTAUTH_URL", "https://example.invalid");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.invalid");
  vi.stubEnv("EMAIL_LOGO_URL", "./logo.png");
});
afterEach(() => {
  expect(forbidden.database).not.toHaveBeenCalled();
  expect(forbidden.send).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  if (process.env.WRITE_SYNTHETIC_EMAIL_PREVIEWS === "1") {
    vi.stubEnv("NEXTAUTH_URL", "https://example.invalid");
    vi.stubEnv("EMAIL_LOGO_URL", "./logo.png");
    await writeSyntheticEmailPreview(
      resolve(process.cwd(), ".local/qa/gopay-pilot-20261111/email-visual"),
    );
    vi.unstubAllEnvs();
  }
});

describe("shared transactional email frame", () => {
  it.each(["ru", "kg", "en"] as const)(
    "renders one responsive presentation document in %s",
    (locale) => {
      const longWord = "СинтетическоеОченьДлинноеНазвание".repeat(12);
      const html = renderBrandedEmail({
        locale,
        title: longWord,
        preheader: "Synthetic preview",
        contentHtml: `<p id="synthetic-content">${longWord}</p>`,
        footerHtml: `<p id="synthetic-footer">${longWord}</p>`,
      });
      const doc = parse(html);
      assertSafeDocument(doc, locale);
      expect(doc.querySelector("h1")?.textContent).toBe(longWord);
      expect(doc.querySelector("#synthetic-footer")?.closest(frame)).not.toBeNull();
      for (const selector of ["h1", "#synthetic-content", "#synthetic-footer"]) {
        expect(hasWordWrapping(doc.querySelector(selector))).toBe(true);
      }
      expect(html).toMatch(/max-width:\s*560px/);
      expect(html).toMatch(/width:\s*100%/);
      expect(html).toMatch(
        /(?:overflow-wrap:\s*(?:anywhere|break-word)|word-break:\s*break-(?:all|word))/,
      );
      const logo = doc.querySelector("img")!;
      expect(logo.getAttribute("src")).toBe("./logo.png");
      expect(logo.getAttribute("width")).toBe("180");
      expect(logo.style.maxWidth).toBe("100%");
    },
  );

  it("escapes scalar headers and button values while preserving intentional prepared body/footer markup", () => {
    const unsafe = '<img src=x onerror="synthetic()"> & "quoted"';
    const href = `https://example.invalid/action?token=synthetic&next=${unsafe}`;
    const html = renderBrandedEmail({
      title: unsafe,
      brandName: unsafe,
      preheader: unsafe,
      logoUrl: `https://example.invalid/logo.png?name=${unsafe}`,
      contentHtml: `<p id="intentional-body">${escapeEmailHtml(unsafe)}</p>${renderEmailButton({ href, label: unsafe })}`,
      footerHtml: '<em id="intentional-footer">Prepared safe footer</em>',
    });
    const doc = parse(html);
    assertSafeDocument(doc, "ru");
    expect(doc.querySelector("h1")?.textContent).toBe(unsafe);
    expect(doc.querySelector("#intentional-body")?.textContent).toBe(unsafe);
    expect(doc.querySelector("#intentional-footer")?.tagName).toBe("EM");
    expect(doc.querySelectorAll("img")).toHaveLength(1);
    const action = Array.from(doc.querySelectorAll("a")).find(
      (item) => item.getAttribute("href") === href,
    )!;
    expect(action.textContent?.trim()).toBe(unsafe);
    expect(action.getAttribute("onerror")).toBeNull();
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(
      `https://example.invalid/logo.png?name=${unsafe}`,
    );
  });

  it("uses the configured logo or app URL and supports legacy Kyrgyz locale without mutating a prepared body", () => {
    expect(getEmailLogoUrl()).toBe("./logo.png");
    vi.stubEnv("EMAIL_LOGO_URL", "");
    vi.stubEnv("NEXTAUTH_URL", "https://example.invalid///");
    expect(getEmailLogoUrl()).toBe("https://example.invalid/brand/logo.png");
    const doc = parse(
      renderBrandedEmail({ locale: "ky", contentHtml: '<b id="body">Synthetic</b>' }),
    );
    assertSafeDocument(doc, "kg");
    expect(doc.querySelector("#body")?.textContent).toBe("Synthetic");
  });
});

describe("real transactional email builders", () => {
  it("defaults account emails to Russian and accepts the existing Kyrgyz locale alias", () => {
    for (const locale of [undefined, "not-a-supported-locale", "ky"]) {
      const expectedLocale = locale === "ky" ? "kg" : "ru";
      const messages = [
        buildVerificationEmail({
          email: syntheticEmailRecipient,
          verifyLink: syntheticActionUrl,
          locale,
        }),
        buildResetEmail({ email: syntheticEmailRecipient, resetLink: syntheticActionUrl, locale }),
        buildInviteEmail({
          email: syntheticEmailRecipient,
          inviteLink: syntheticActionUrl,
          locale,
        }),
        buildLoyaltyOtpEmail({
          email: syntheticEmailRecipient,
          code: "024681",
          challengeId: "synthetic",
          locale,
        }),
      ];
      for (const item of messages) assertSafeDocument(parse(item.html), expectedLocale);
    }
  });

  it("uses a distinct localized subject for each account service family", () => {
    const localized = (["ru", "kg", "en"] as const).map(createSyntheticAccountEmails);
    for (let family = 0; family < localized[0].length; family++) {
      expect(new Set(localized.map((items) => items[family].payload.subject)).size).toBe(3);
    }
  });
  it.each(["ru", "kg", "en"] as const)(
    "keeps activation, reset, invitation and OTP content/action/identity in %s",
    (locale) => {
      const kinds = ["signup_verification", "password_reset", "organization_invite", "loyalty_otp"];
      for (const [index, item] of createSyntheticAccountEmails(locale).entries()) {
        const doc = parse(item.payload.html);
        assertSafeDocument(doc, locale);
        expect(item.payload.to).toBe(syntheticEmailRecipient);
        expect(item.payload.subject.length).toBeGreaterThan(8);
        expect(item.payload.text.length).toBeGreaterThan(20);
        expect(item.payload.text).not.toMatch(/<\/?(?:html|table|p)\b/);
        expect(item.payload.tags).toContainEqual({ name: "kind", value: kinds[index] });
        if (item.action) {
          expect(item.payload.text).toContain(item.action);
          const action = Array.from(doc.querySelectorAll("a")).find(
            (link) => link.getAttribute("href") === item.action,
          );
          expect(action?.textContent?.trim().length).toBeGreaterThan(0);
        } else {
          expect(doc.body.textContent).toContain("024681");
          expect(item.payload.text).toContain("024681");
          expect(item.payload.text).toContain("10");
          expect(item.payload.idempotencyKey).toBe("loyalty-otp-synthetic-otp-challenge");
        }
      }
    },
  );

  it.each(["ru", "kg", "en"] as const)(
    "escapes activation/reset/invitation links and OTP scalar content in %s",
    (locale) => {
      const attack = '<img src=x onerror="synthetic()">';
      const href = `https://example.invalid/synthetic?next=${attack}&token="quoted"`;
      const messages = [
        buildVerificationEmail({ email: syntheticEmailRecipient, verifyLink: href, locale }),
        buildResetEmail({ email: syntheticEmailRecipient, resetLink: href, locale }),
        buildInviteEmail({ email: syntheticEmailRecipient, inviteLink: href, locale }),
      ];
      for (const item of messages) {
        const doc = parse(item.html);
        assertSafeDocument(doc, locale);
        expect(doc.querySelectorAll("img")).toHaveLength(1);
        expect(
          Array.from(doc.querySelectorAll("a")).some((link) => link.getAttribute("href") === href),
        ).toBe(true);
        expect(item.text).toContain(href);
      }
      const otp = buildLoyaltyOtpEmail({
        email: syntheticEmailRecipient,
        code: attack,
        challengeId: "synthetic",
        locale,
      });
      const doc = parse(otp.html);
      assertSafeDocument(doc, locale);
      expect(doc.body.textContent).toContain(attack);
      expect(doc.querySelectorAll("img")).toHaveLength(1);
    },
  );

  it.each(["ru", "kg", "en"] as const)(
    "keeps billing facts, service footer and canonical action in %s",
    (locale) => {
      const organization = '<script>synthetic()</script> & "Synthetic"';
      const payment = subscriptionPaymentNotificationContent({
        kind: "PAYMENT_CONFIRMED",
        language: locale,
        organizationName: organization,
        amountMinor: 200000,
        plan: "STARTER",
        startsAt: syntheticEmailDate,
        endsAt: syntheticEmailEnd,
        confirmedAt: syntheticEmailDate,
      });
      const reminder = subscriptionReminderContent(
        { source: "TRIAL", kind: "BEFORE_3", accessEndsAt: syntheticEmailEnd, graceEndsAt: null },
        organization,
        locale,
      );
      for (const message of [payment, reminder]) {
        const doc = parse(message.html);
        assertSafeDocument(doc, locale);
        expect(doc.body.textContent).toContain(organization);
        expect(message.text).toContain(organization);
        expect(message.text).toContain("https://bazaar.kg/billing");
        const action = doc.querySelector('a[href="https://bazaar.kg/billing"]');
        expect(action?.textContent?.trim().length).toBeGreaterThan(0);
        const serviceFooter = message.text.split("\n\n").at(-1)!;
        expect(doc.body.textContent).toContain(serviceFooter);
        expect(doc.querySelector('a[href*="unsubscribe"]')).toBeNull();
      }
    },
  );

  it.each(orderEmailFamilies)(
    "uses one shared frame and preserves historical text/tags/key for order %s",
    (type) => {
      const order = createSyntheticOrderEmailRecord();
      order.store.name = '<script>synthetic()</script> & "Store"';
      order.customerName = '<img src=x onerror="synthetic()">';
      order.lines[0].product.name = "<script>product()</script>";
      order.lines[0].product.sku = "SYNTHETIC-LONG-SKU-".repeat(20);
      const current = buildOrderEmailPayload(type, order, syntheticEmailRecipient);
      const legacy = buildOrderEmailPayload(type, order, syntheticEmailRecipient, null);
      expect(legacy).toMatchSnapshot();
      const merchant = buildOrderEmailPayload(type, order, syntheticEmailRecipient, "branded-v1", {
        merchantBrand: true,
      });
      const merchantDoc = parse(merchant.html);
      assertSafeDocument(merchantDoc, type === "OWNER_NOTIFICATION" ? "ru" : "en");
      expect(merchantDoc.body.textContent?.split(order.store.name)).toHaveLength(2);
      expect(merchantDoc.querySelector("img")).toBeNull();
      expect(merchant.text).toBe(current.text);
      expect(merchant.idempotencyKey).toBe(current.idempotencyKey);
      expect(
        buildOrderEmailPayload(type, order, syntheticEmailRecipient, null, { merchantBrand: true }),
      ).toEqual(legacy);
      const doc = parse(current.html);
      assertSafeDocument(doc, type === "OWNER_NOTIFICATION" ? "ru" : "en");
      expect(doc.querySelector("img")?.getAttribute("alt")).toBe("BAZAAR");
      expect(current.text).toBe(legacy.text);
      expect(current.subject).toBe(legacy.subject);
      expect(current.tags).toEqual(legacy.tags);
      expect(current.idempotencyKey).toBe(legacy.idempotencyKey);
      expect(current.text).toContain(order.number);
      expect(doc.body.textContent).toContain(order.store.name);
      expect(parse(legacy.html).querySelector(frame)).toBeNull();
      if (type !== "OWNER_NOTIFICATION") {
        expect(doc.body.textContent).toContain(order.lines[0].product.sku);
        expect(doc.body.textContent).toContain(order.lines[0].product.name);
      }
      if (type === "TRACKING") {
        expect(doc.querySelector(`a[href="${syntheticActionUrl}"]`)).not.toBeNull();
        expect(current.text).toContain(order.trackingNumber);
      }
      if (type === "OWNER_NOTIFICATION") {
        expect(
          doc.querySelector(`a[href="https://example.invalid/sales/orders/${order.id}"]`),
        ).not.toBeNull();
      }
    },
  );

  it("generates a complete synthetic preview gallery from the same real builders", () => {
    const gallery = createSyntheticEmailGallery();
    expect(gallery).toHaveLength(35);
    expect(new Set(gallery.map(({ name }) => name)).size).toBe(gallery.length);
    for (const item of gallery) {
      assertSafeDocument(parse(item.html), item.locale);
      expect(item.text.length).toBeGreaterThan(20);
    }
    expect(gallery.some((item) => item.text.includes(syntheticOrganizationName))).toBe(true);
  });
});
