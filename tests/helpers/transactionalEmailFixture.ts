import { CustomerOrderEmailType, Prisma } from "@prisma/client";

import { buildInviteEmail, buildResetEmail, buildVerificationEmail } from "@/server/services/email";
import { buildLoyaltyOtpEmail } from "@/server/services/loyalty/memberAuth";
import { buildOrderEmailPayload, type OrderEmailRecord } from "@/server/services/orderEmails";
import { subscriptionPaymentNotificationContent } from "@/server/billing/paymentNotificationContent";
import { subscriptionReminderContent } from "@/server/billing/reminderContent";
import type { Locale } from "@/lib/locales";

export const syntheticEmailRecipient = "synthetic@example.invalid";
export const syntheticActionUrl =
  "https://example.invalid/action/synthetic-token?context=email&next=billing";
export const syntheticEmailDate = new Date("2026-11-11T10:00:00Z");
export const syntheticEmailEnd = new Date("2026-12-11T10:00:00Z");
export const syntheticOrganizationName = "Синтетический магазин / Synthetic shop";

/** This record contains no customer data and is never persisted or sent. */
export function createSyntheticOrderEmailRecord(): OrderEmailRecord {
  return {
    id: "synthetic-order-email",
    organizationId: "synthetic-organization-email",
    storeId: "synthetic-store-email",
    number: "SYNTHETIC-001",
    customerName: "Synthetic customer",
    customerEmail: syntheticEmailRecipient,
    customerAddress: "Synthetic address",
    customerPhone: null,
    status: "CONFIRMED",
    source: "API",
    createdAt: syntheticEmailDate,
    confirmedAt: syntheticEmailDate,
    completedAt: syntheticEmailDate,
    canceledAt: syntheticEmailDate,
    subtotalKgs: new Prisma.Decimal(1250),
    totalKgs: new Prisma.Decimal(1250),
    currencyCode: "KGS",
    currencyRateKgsPerUnit: new Prisma.Decimal(1),
    confirmationEmailSentAt: null,
    trackingNumber: "SYNTHETIC-TRACKING",
    trackingCarrier: "Synthetic carrier",
    trackingUrl: syntheticActionUrl,
    trackingStatus: "In transit",
    trackingEmailSentAt: null,
    followUpEmailSentAt: null,
    store: {
      name: syntheticOrganizationName,
      code: "SYNTHETIC",
      currencyCode: "KGS",
      currencyRateKgsPerUnit: new Prisma.Decimal(1),
    },
    lines: [
      {
        qty: 2,
        unitPriceKgs: new Prisma.Decimal(625),
        lineTotalKgs: new Prisma.Decimal(1250),
        product: { name: "Synthetic product", sku: "SYNTHETIC-SKU-001" },
        variant: { name: "Synthetic variant" },
      },
    ],
  };
}

export const orderEmailFamilies = [
  CustomerOrderEmailType.CONFIRMATION,
  CustomerOrderEmailType.TRACKING,
  CustomerOrderEmailType.CANCELLATION,
  CustomerOrderEmailType.FOLLOW_UP,
  CustomerOrderEmailType.OWNER_NOTIFICATION,
] as const;

export function createSyntheticAccountEmails(locale: Locale) {
  return [
    {
      family: "verification",
      action: syntheticActionUrl,
      payload: buildVerificationEmail({
        email: syntheticEmailRecipient,
        verifyLink: syntheticActionUrl,
        locale,
        expiresInMinutes: 45,
      }),
    },
    {
      family: "reset",
      action: syntheticActionUrl,
      payload: buildResetEmail({
        email: syntheticEmailRecipient,
        resetLink: syntheticActionUrl,
        locale,
      }),
    },
    {
      family: "invite",
      action: syntheticActionUrl,
      payload: buildInviteEmail({
        email: syntheticEmailRecipient,
        inviteLink: syntheticActionUrl,
        locale,
      }),
    },
    {
      family: "loyalty-otp",
      action: null,
      payload: buildLoyaltyOtpEmail({
        email: syntheticEmailRecipient,
        code: "024681",
        challengeId: "synthetic-otp-challenge",
        locale,
      }),
    },
  ];
}

export function createSyntheticEmailGallery() {
  const result: { name: string; locale: Locale; subject: string; text: string; html: string }[] =
    [];
  for (const locale of ["ru", "kg", "en"] as const) {
    for (const account of createSyntheticAccountEmails(locale)) {
      result.push({ name: `${account.family}-${locale}`, locale, ...account.payload });
    }
    for (const [name, startsAt] of [
      ["payment-confirmed", syntheticEmailDate],
      ["payment-future", syntheticEmailEnd],
    ] as const) {
      result.push({
        name: `${name}-${locale}`,
        ...subscriptionPaymentNotificationContent({
          kind: "ACCESS_RESTORED",
          language: locale,
          organizationName: syntheticOrganizationName,
          amountMinor: 200000,
          plan: "STARTER",
          confirmedAt: syntheticEmailDate,
          startsAt,
          endsAt: new Date("2027-01-11T10:00:00Z"),
        }),
      });
    }
    for (const [name, source, kind] of [
      ["trial-reminder", "TRIAL", "BEFORE_3"],
      ["paid-reminder", "PAID", "BEFORE_1"],
      ["paid-grace", "PAID", "GRACE"],
      ["expired-access", "TRIAL", "READ_ONLY"],
    ] as const) {
      result.push({
        name: `${name}-${locale}`,
        ...subscriptionReminderContent(
          {
            source,
            kind,
            accessEndsAt: syntheticEmailEnd,
            graceEndsAt: source === "PAID" ? new Date("2026-12-18T10:00:00Z") : null,
          },
          syntheticOrganizationName,
          locale,
        ),
      });
    }
  }
  for (const type of orderEmailFamilies) {
    result.push({
      name: `order-${type.toLowerCase()}`,
      locale: type === "OWNER_NOTIFICATION" ? "ru" : "en",
      ...buildOrderEmailPayload(type, createSyntheticOrderEmailRecord(), syntheticEmailRecipient),
    });
  }
  return result;
}
