import {
  CustomerOrderEmailStatus,
  CustomerOrderEmailType,
  CustomerOrderStatus,
  type Prisma,
} from "@prisma/client";

import {
  convertFromKgs,
  normalizeCurrencyCode,
  normalizeCurrencyRateKgsPerUnit,
} from "@/lib/currency";
import { defaultTimeZone } from "@/lib/timezone";
import { prisma } from "@/server/db/prisma";
import { getLogger } from "@/server/logging";
import { sendTransactionalEmail, type EmailPayload } from "@/server/services/email";
import { resolveStorePrimaryVerifiedSender } from "@/server/services/emailMarketing";
import { AppError } from "@/server/services/errors";

type OrderEmailLine = {
  qty: number;
  unitPriceKgs: Prisma.Decimal;
  lineTotalKgs: Prisma.Decimal;
  product: {
    name: string;
    sku: string;
  };
  variant: {
    name: string | null;
  } | null;
};

type OrderEmailRecord = {
  id: string;
  organizationId: string;
  storeId: string;
  number: string;
  customerName: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  customerPhone: string | null;
  status: CustomerOrderStatus;
  source: string;
  createdAt: Date;
  confirmedAt: Date | null;
  completedAt: Date | null;
  canceledAt: Date | null;
  subtotalKgs: Prisma.Decimal;
  totalKgs: Prisma.Decimal;
  currencyCode: string | null;
  currencyRateKgsPerUnit: Prisma.Decimal | null;
  confirmationEmailSentAt: Date | null;
  trackingNumber: string | null;
  trackingCarrier: string | null;
  trackingUrl: string | null;
  trackingStatus: string | null;
  trackingEmailSentAt: Date | null;
  followUpEmailSentAt: Date | null;
  store: {
    name: string;
    code: string;
    currencyCode: string;
    currencyRateKgsPerUnit: Prisma.Decimal;
  };
  lines: OrderEmailLine[];
};

export type OrderEmailSendResult = {
  status: "sent" | "skipped";
  reason?: "alreadySent" | "missingEmail" | "missingTracking";
  recipientEmail?: string | null;
};

export type OrderEmailLanguage = "en" | "ru";

const defaultOrderEmailLanguage: OrderEmailLanguage = "en";
const dateLocaleByLanguage: Record<OrderEmailLanguage, string> = {
  en: "en-US",
  ru: "ru-RU",
};

const trimToNull = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const normalizeRecipientEmail = (value?: string | null) => trimToNull(value)?.toLowerCase() ?? null;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatOptional = (value?: string | null, fallback = "-") => trimToNull(value) ?? fallback;

export const formatOrderEmailDate = (
  value?: Date | null,
  language: OrderEmailLanguage = defaultOrderEmailLanguage,
) =>
  value
    ? new Intl.DateTimeFormat(dateLocaleByLanguage[language], {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: defaultTimeZone,
      }).format(value)
    : "-";

const resolveCurrency = (order: OrderEmailRecord) => {
  const currencyCode = normalizeCurrencyCode(order.currencyCode ?? order.store.currencyCode);
  const currencyRateKgsPerUnit = normalizeCurrencyRateKgsPerUnit(
    Number(order.currencyRateKgsPerUnit ?? order.store.currencyRateKgsPerUnit),
    currencyCode,
  );
  return { currencyCode, currencyRateKgsPerUnit };
};

const formatMoney = (valueKgs: Prisma.Decimal | number, order: OrderEmailRecord) => {
  const { currencyCode, currencyRateKgsPerUnit } = resolveCurrency(order);
  const value = convertFromKgs(Number(valueKgs), currencyRateKgsPerUnit, currencyCode);
  try {
    return new Intl.NumberFormat(dateLocaleByLanguage[defaultOrderEmailLanguage], {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${Number(value.toFixed(2))} ${currencyCode}`;
  }
};

const getOrderForEmail = async (input: { organizationId: string; customerOrderId: string }) => {
  const order = await prisma.customerOrder.findFirst({
    where: {
      id: input.customerOrderId,
      organizationId: input.organizationId,
    },
    include: {
      store: {
        select: {
          name: true,
          code: true,
          currencyCode: true,
          currencyRateKgsPerUnit: true,
        },
      },
      lines: {
        include: {
          product: {
            select: {
              name: true,
              sku: true,
            },
          },
          variant: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!order) {
    throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
  }

  return order;
};

const createEmailLog = async (input: {
  order: OrderEmailRecord;
  type: CustomerOrderEmailType;
  status: CustomerOrderEmailStatus;
  recipientEmail?: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  triggeredById?: string | null;
}) =>
  prisma.customerOrderEmailLog.create({
    data: {
      organizationId: input.order.organizationId,
      storeId: input.order.storeId,
      customerOrderId: input.order.id,
      type: input.type,
      status: input.status,
      recipientEmail: input.recipientEmail ?? null,
      provider: input.provider ?? null,
      providerMessageId: input.providerMessageId ?? null,
      errorMessage: input.errorMessage ?? null,
      triggeredById: input.triggeredById ?? null,
    },
  });

const updateSentTimestamp = (input: {
  orderId: string;
  type: CustomerOrderEmailType;
  sentAt: Date;
}) => {
  if (input.type === CustomerOrderEmailType.CONFIRMATION) {
    return prisma.customerOrder.update({
      where: { id: input.orderId },
      data: { confirmationEmailSentAt: input.sentAt },
    });
  }
  if (input.type === CustomerOrderEmailType.TRACKING) {
    return prisma.customerOrder.update({
      where: { id: input.orderId },
      data: { trackingEmailSentAt: input.sentAt },
    });
  }
  if (input.type === CustomerOrderEmailType.CANCELLATION) {
    return Promise.resolve();
  }
  return prisma.customerOrder.update({
    where: { id: input.orderId },
    data: { followUpEmailSentAt: input.sentAt },
  });
};

const alreadySentAt = (order: OrderEmailRecord, type: CustomerOrderEmailType) => {
  if (type === CustomerOrderEmailType.CONFIRMATION) {
    return order.confirmationEmailSentAt;
  }
  if (type === CustomerOrderEmailType.TRACKING) {
    return order.trackingEmailSentAt;
  }
  if (type === CustomerOrderEmailType.CANCELLATION) {
    return null;
  }
  return order.followUpEmailSentAt;
};

const buildLinesText = (order: OrderEmailRecord) =>
  order.lines.length
    ? order.lines
        .map((line) => {
          const variant = line.variant?.name ? ` (${line.variant.name})` : "";
          return `- ${line.product.name}${variant} x ${line.qty}: ${formatMoney(
            line.lineTotalKgs,
            order,
          )}`;
        })
        .join("\n")
    : "-";

const buildLinesHtml = (order: OrderEmailRecord) =>
  order.lines.length
    ? `<table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr>
            <th align="left" style="border-bottom:1px solid #e5e7eb;padding:8px 0;color:#6b7280;font-size:12px;">Item</th>
            <th align="right" style="border-bottom:1px solid #e5e7eb;padding:8px 0;color:#6b7280;font-size:12px;">Qty</th>
            <th align="right" style="border-bottom:1px solid #e5e7eb;padding:8px 0;color:#6b7280;font-size:12px;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${order.lines
            .map((line) => {
              const variant = line.variant?.name ? ` (${line.variant.name})` : "";
              return `<tr>
                <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;">
                  <div style="font-weight:600;color:#111827;">${escapeHtml(line.product.name)}${escapeHtml(variant)}</div>
                  <div style="color:#6b7280;font-size:12px;">${escapeHtml(line.product.sku)}</div>
                </td>
                <td align="right" style="padding:10px 0;border-bottom:1px solid #f3f4f6;color:#111827;">${line.qty}</td>
                <td align="right" style="padding:10px 0;border-bottom:1px solid #f3f4f6;color:#111827;">${escapeHtml(formatMoney(line.lineTotalKgs, order))}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`
    : `<p style="color:#6b7280;">No items.</p>`;

const emailFrame = (input: { title: string; intro: string; body: string; storeName: string }) => `
  <div style="font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;background:#f5f7fb;padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;">
      <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">${escapeHtml(input.storeName)}</p>
      <h1 style="margin:0 0 12px;color:#111827;font-size:22px;line-height:1.3;">${escapeHtml(input.title)}</h1>
      <p style="margin:0 0 16px;color:#374151;">${escapeHtml(input.intro)}</p>
      ${input.body}
      <p style="margin:20px 0 0;color:#6b7280;font-size:12px;">This message was sent by BAZAAR.</p>
    </div>
  </div>
`;

const buildConfirmationPayload = (order: OrderEmailRecord, recipientEmail: string) => {
  const subject = `Order ${order.number} confirmation`;
  const customerName = formatOptional(order.customerName, "Customer");
  const text = [
    `Hello ${customerName},`,
    "",
    `Your order ${order.number} has been received by ${order.store.name}.`,
    `Order date: ${formatOrderEmailDate(order.confirmedAt ?? order.createdAt)}`,
    `Status: ${order.status}`,
    `Customer: ${customerName}`,
    `Delivery/pickup: ${formatOptional(order.customerAddress)}`,
    "",
    "Items:",
    buildLinesText(order),
    "",
    `Total: ${formatMoney(order.totalKgs, order)}`,
  ].join("\n");

  const html = emailFrame({
    storeName: order.store.name,
    title: `Order ${order.number} confirmation`,
    intro: `Hello ${customerName}, your order has been received.`,
    body: `
      <dl style="margin:0;color:#111827;">
        <dt style="color:#6b7280;font-size:12px;">Order date</dt>
        <dd style="margin:0 0 10px;">${escapeHtml(formatOrderEmailDate(order.confirmedAt ?? order.createdAt))}</dd>
        <dt style="color:#6b7280;font-size:12px;">Customer</dt>
        <dd style="margin:0 0 10px;">${escapeHtml(customerName)}</dd>
        <dt style="color:#6b7280;font-size:12px;">Delivery/pickup</dt>
        <dd style="margin:0 0 10px;">${escapeHtml(formatOptional(order.customerAddress))}</dd>
      </dl>
      ${buildLinesHtml(order)}
      <p style="margin:16px 0 0;font-size:18px;font-weight:700;color:#111827;">Total: ${escapeHtml(formatMoney(order.totalKgs, order))}</p>
    `,
  });

  return {
    to: recipientEmail,
    subject,
    text,
    html,
    tags: [
      { name: "kind", value: "order_confirmation" },
      { name: "order_id", value: order.id },
    ],
    idempotencyKey: `customer-order-confirmation-${order.id}`,
  };
};

const buildCancellationPayload = (order: OrderEmailRecord, recipientEmail: string) => {
  const subject = `Order ${order.number} canceled`;
  const customerName = formatOptional(order.customerName, "Customer");
  const canceledAt = formatOrderEmailDate(order.canceledAt ?? new Date());
  const statusLabel = "Canceled";
  const text = [
    `Hello ${customerName},`,
    "",
    `Your order ${order.number} from ${order.store.name} was canceled.`,
    `Status: ${statusLabel}`,
    `Canceled at: ${canceledAt}`,
    "",
    "If a payment has already been captured, refund handling will follow the store policy.",
    "",
    "Order summary:",
    buildLinesText(order),
    "",
    `Total: ${formatMoney(order.totalKgs, order)}`,
  ].join("\n");

  const html = emailFrame({
    storeName: order.store.name,
    title: `Order ${order.number} canceled`,
    intro: `Hello ${customerName}, your order was canceled.`,
    body: `
      <dl style="margin:0;color:#111827;">
        <dt style="color:#6b7280;font-size:12px;">Status</dt>
        <dd style="margin:0 0 10px;font-weight:700;">${escapeHtml(statusLabel)}</dd>
        <dt style="color:#6b7280;font-size:12px;">Canceled at</dt>
        <dd style="margin:0 0 10px;">${escapeHtml(canceledAt)}</dd>
      </dl>
      <p style="margin:0 0 16px;color:#374151;">If a payment has already been captured, refund handling will follow the store policy.</p>
      ${buildLinesHtml(order)}
      <p style="margin:16px 0 0;font-size:18px;font-weight:700;color:#111827;">Total: ${escapeHtml(formatMoney(order.totalKgs, order))}</p>
    `,
  });

  return {
    to: recipientEmail,
    subject,
    text,
    html,
    tags: [
      { name: "kind", value: "order_cancellation" },
      { name: "order_id", value: order.id },
    ],
    idempotencyKey: `customer-order-cancellation-${order.id}`,
  };
};

const buildTrackingPayload = (order: OrderEmailRecord, recipientEmail: string) => {
  const trackingNumber = formatOptional(order.trackingNumber);
  const carrier = formatOptional(order.trackingCarrier);
  const subject = `Tracking for order ${order.number}`;
  const customerName = formatOptional(order.customerName, "Customer");
  const trackingUrl = trimToNull(order.trackingUrl);
  const text = [
    `Hello ${customerName},`,
    "",
    `Tracking information was added for order ${order.number}.`,
    `Tracking number: ${trackingNumber}`,
    `Carrier: ${carrier}`,
    `Status: ${formatOptional(order.trackingStatus)}`,
    trackingUrl ? `Tracking link: ${trackingUrl}` : null,
    "",
    "Order summary:",
    buildLinesText(order),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const html = emailFrame({
    storeName: order.store.name,
    title: `Tracking for order ${order.number}`,
    intro: `Hello ${customerName}, tracking information is available for your order.`,
    body: `
      <dl style="margin:0;color:#111827;">
        <dt style="color:#6b7280;font-size:12px;">Tracking number</dt>
        <dd style="margin:0 0 10px;font-weight:700;">${escapeHtml(trackingNumber)}</dd>
        <dt style="color:#6b7280;font-size:12px;">Carrier</dt>
        <dd style="margin:0 0 10px;">${escapeHtml(carrier)}</dd>
        <dt style="color:#6b7280;font-size:12px;">Status</dt>
        <dd style="margin:0 0 10px;">${escapeHtml(formatOptional(order.trackingStatus))}</dd>
      </dl>
      ${
        trackingUrl
          ? `<p style="margin:16px 0;"><a href="${escapeHtml(trackingUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:600;">Track order</a></p>`
          : ""
      }
      ${buildLinesHtml(order)}
    `,
  });

  return {
    to: recipientEmail,
    subject,
    text,
    html,
    tags: [
      { name: "kind", value: "order_tracking" },
      { name: "order_id", value: order.id },
    ],
    idempotencyKey: `customer-order-tracking-${order.id}-${trackingNumber}`,
  };
};

const buildFollowUpPayload = (order: OrderEmailRecord, recipientEmail: string) => {
  const subject = `How was order ${order.number}?`;
  const customerName = formatOptional(order.customerName, "Customer");
  const text = [
    `Hello ${customerName},`,
    "",
    `We hope everything went well with your order ${order.number} from ${order.store.name}.`,
    "Thank you for your purchase.",
    "",
    "Order summary:",
    buildLinesText(order),
    "",
    `Total: ${formatMoney(order.totalKgs, order)}`,
  ].join("\n");

  const html = emailFrame({
    storeName: order.store.name,
    title: `How was order ${order.number}?`,
    intro: `Hello ${customerName}, we hope everything went well with your order.`,
    body: `
      ${buildLinesHtml(order)}
      <p style="margin:16px 0 0;font-size:18px;font-weight:700;color:#111827;">Total: ${escapeHtml(formatMoney(order.totalKgs, order))}</p>
      <p style="margin:16px 0 0;color:#374151;">Thank you for your purchase.</p>
    `,
  });

  return {
    to: recipientEmail,
    subject,
    text,
    html,
    tags: [
      { name: "kind", value: "order_follow_up" },
      { name: "order_id", value: order.id },
    ],
    idempotencyKey: `customer-order-follow-up-${order.id}`,
  };
};

const buildEmailPayload = (
  type: CustomerOrderEmailType,
  order: OrderEmailRecord,
  recipientEmail: string,
): EmailPayload => {
  if (type === CustomerOrderEmailType.CONFIRMATION) {
    return buildConfirmationPayload(order, recipientEmail);
  }
  if (type === CustomerOrderEmailType.TRACKING) {
    return buildTrackingPayload(order, recipientEmail);
  }
  if (type === CustomerOrderEmailType.CANCELLATION) {
    return buildCancellationPayload(order, recipientEmail);
  }
  return buildFollowUpPayload(order, recipientEmail);
};

const hasSentEmail = async (order: OrderEmailRecord, type: CustomerOrderEmailType) => {
  const sentAt = alreadySentAt(order, type);
  if (sentAt) {
    return true;
  }
  if (type !== CustomerOrderEmailType.CANCELLATION) {
    return false;
  }
  const sentLog = await prisma.customerOrderEmailLog.findFirst({
    where: {
      customerOrderId: order.id,
      type,
      status: CustomerOrderEmailStatus.SENT,
    },
    select: { id: true },
  });
  return Boolean(sentLog);
};

const sendOrderEmail = async (input: {
  organizationId: string;
  customerOrderId: string;
  type: CustomerOrderEmailType;
  triggeredById?: string | null;
  force?: boolean;
  throwOnMissingEmail?: boolean;
}): Promise<OrderEmailSendResult> => {
  const order = await getOrderForEmail(input);

  if (!input.force && (await hasSentEmail(order, input.type))) {
    return {
      status: "skipped",
      reason: "alreadySent",
      recipientEmail: normalizeRecipientEmail(order.customerEmail),
    };
  }

  const recipientEmail = normalizeRecipientEmail(order.customerEmail);
  if (!recipientEmail) {
    await createEmailLog({
      order,
      type: input.type,
      status: CustomerOrderEmailStatus.SKIPPED,
      recipientEmail: null,
      errorMessage: "customerEmailMissing",
      triggeredById: input.triggeredById,
    });
    if (input.throwOnMissingEmail === false) {
      return { status: "skipped", reason: "missingEmail", recipientEmail: null };
    }
    throw new AppError("customerEmailMissing", "BAD_REQUEST", 400);
  }

  if (input.type === CustomerOrderEmailType.TRACKING && !trimToNull(order.trackingNumber)) {
    await createEmailLog({
      order,
      type: input.type,
      status: CustomerOrderEmailStatus.SKIPPED,
      recipientEmail,
      errorMessage: "trackingNumberMissing",
      triggeredById: input.triggeredById,
    });
    throw new AppError("trackingNumberMissing", "BAD_REQUEST", 400);
  }

  const payload = buildEmailPayload(input.type, order, recipientEmail);
  const sender = await resolveStorePrimaryVerifiedSender({
    organizationId: order.organizationId,
    storeId: order.storeId,
  });
  if (sender) {
    payload.from = sender.from;
    payload.replyTo = sender.replyTo;
  }
  if (input.force && payload.idempotencyKey) {
    payload.idempotencyKey = `${payload.idempotencyKey}-${Date.now()}`;
  }
  try {
    const result = await sendTransactionalEmail(payload);
    const sentAt = new Date();
    await updateSentTimestamp({ orderId: order.id, type: input.type, sentAt });
    await createEmailLog({
      order,
      type: input.type,
      status: CustomerOrderEmailStatus.SENT,
      recipientEmail,
      provider: result.provider,
      providerMessageId: result.id,
      triggeredById: input.triggeredById,
    });
    return { status: "sent", recipientEmail };
  } catch (error) {
    const message = error instanceof Error ? error.message : "emailSendFailed";
    await createEmailLog({
      order,
      type: input.type,
      status: CustomerOrderEmailStatus.FAILED,
      recipientEmail,
      errorMessage: message,
      triggeredById: input.triggeredById,
    });
    throw new AppError("orderEmailSendFailed", "INTERNAL_SERVER_ERROR", 500);
  }
};

export const sendOrderConfirmationEmail = (input: {
  organizationId: string;
  customerOrderId: string;
  triggeredById?: string | null;
  force?: boolean;
  throwOnMissingEmail?: boolean;
}) =>
  sendOrderEmail({
    ...input,
    type: CustomerOrderEmailType.CONFIRMATION,
  });

export const sendOrderTrackingEmail = (input: {
  organizationId: string;
  customerOrderId: string;
  triggeredById?: string | null;
  force?: boolean;
  throwOnMissingEmail?: boolean;
}) =>
  sendOrderEmail({
    ...input,
    type: CustomerOrderEmailType.TRACKING,
  });

export const sendOrderFollowUpEmail = (input: {
  organizationId: string;
  customerOrderId: string;
  triggeredById?: string | null;
  force?: boolean;
  throwOnMissingEmail?: boolean;
}) =>
  sendOrderEmail({
    ...input,
    type: CustomerOrderEmailType.FOLLOW_UP,
  });

export const sendOrderCancellationEmail = (input: {
  organizationId: string;
  customerOrderId: string;
  triggeredById?: string | null;
  force?: boolean;
  throwOnMissingEmail?: boolean;
}) =>
  sendOrderEmail({
    ...input,
    type: CustomerOrderEmailType.CANCELLATION,
  });

const followUpDelayMs = 7 * 24 * 60 * 60 * 1000;

export const sendDueOrderFollowUpEmails = async (input?: { now?: Date; limit?: number }) => {
  const logger = getLogger();
  const now = input?.now ?? new Date();
  const cutoff = new Date(now.getTime() - followUpDelayMs);
  const limit = Math.min(Math.max(input?.limit ?? 100, 1), 500);

  const orders = await prisma.customerOrder.findMany({
    where: {
      followUpEmailSentAt: null,
      customerEmail: { not: null },
      status: { in: [CustomerOrderStatus.READY, CustomerOrderStatus.COMPLETED] },
      OR: [
        { completedAt: { lte: cutoff } },
        {
          completedAt: null,
          createdAt: { lte: cutoff },
        },
      ],
    },
    select: {
      id: true,
      organizationId: true,
    },
    orderBy: [{ completedAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const order of orders) {
    try {
      const result = await sendOrderFollowUpEmail({
        organizationId: order.organizationId,
        customerOrderId: order.id,
        throwOnMissingEmail: false,
      });
      if (result.status === "sent") {
        sent += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      logger.warn({ error, customerOrderId: order.id }, "order follow-up email failed");
    }
  }

  return {
    scanned: orders.length,
    sent,
    skipped,
    failed,
  };
};
