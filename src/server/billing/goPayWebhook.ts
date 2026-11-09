import { createHash } from "node:crypto";
import { getLogger } from "@/server/logging";
import { AppError } from "@/server/services/errors";
import { prisma } from "@/server/db/prisma";
import { getGoPayCredentials } from "./paymentConfig";
import { getGoPayStatus, parseGoPayWebhook, readGoPayBody } from "./gopay";
import { goPayReceipt } from "./paymentReceipt";
import { applySubscriptionReceipt } from "./subscriptionPayments";
import { applyWhatsAppReceipt } from "@/server/whatsapp/payments";

export async function handleGoPayNotification(request: Request): Promise<Response> {
  const respond = (status: number) =>
    Response.json(
      { received: status === 200 },
      {
        status,
        headers: { "cache-control": "no-store" },
      },
    );
  const secret = process.env.GOPAY_WEBHOOK_SECRET?.trim();
  if (!secret || process.env.HARDENING_EXTERNAL_PROVIDER_MODE === "disabled") return respond(503);
  try {
    const event = parseGoPayWebhook(
      await readGoPayBody(request),
      {
        nonce: request.headers.get("GoPay-Nonce"),
        signature: request.headers.get("GoPay-Signature"),
      },
      secret,
    );
    if (event.ignored) {
      getLogger().info(
        { provider: "GOPAY", event: event.event, outcome: "acknowledged" },
        "payment webhook",
      );
      return respond(200);
    }
    // Immutable order identity routes independently of the currently selected provider.
    const subscription = await prisma.subscriptionInvoice.findUnique({
      where: { providerOrderId: event.payment.orderId },
    });
    const whatsapp = subscription
      ? null
      : await prisma.whatsAppInvoice.findUnique({
          where: { providerOrderId: event.payment.orderId },
        });
    const invoice = subscription ?? whatsapp;
    // The merchant may use GoPay for unrelated payments and manual Test probes.
    // Authenticated unknown orders are acknowledged, never turned into Bazaar access.
    if (!invoice || invoice.provider !== "GOPAY") {
      getLogger().info(
        {
          provider: "GOPAY",
          event: event.event,
          isTest: event.payment.isTest,
          orderDigest: createHash("sha256")
            .update(event.payment.orderId)
            .digest("hex")
            .slice(0, 16),
          outcome: "unknown_order_ignored",
        },
        "payment webhook",
      );
      return respond(200);
    }
    if (invoice.isTest && process.env.VERCEL_ENV === "production") return respond(409);
    if (
      invoice.isTest !== event.payment.isTest ||
      event.payment.amountMinor !== invoice.amountMinor ||
      (invoice.providerPaymentId && invoice.providerPaymentId !== event.payment.paymentId)
    )
      return respond(409);
    // A signed webhook is a notification to reconcile, not proof of final payment.
    const payment = await getGoPayStatus(
      {
        orderId: invoice.providerOrderId!,
        providerPaymentId: event.payment.paymentId,
        isTest: invoice.isTest,
      },
      getGoPayCredentials(invoice.merchantId),
    );
    const receipt = goPayReceipt(invoice, payment);
    if (subscription)
      await applySubscriptionReceipt({ invoiceId: invoice.id, receipt, source: "CALLBACK" });
    else await applyWhatsAppReceipt({ invoiceId: invoice.id, receipt, source: "CALLBACK" });
    return respond(200);
  } catch (error) {
    // Temporary transport/database failures must be retried by the provider.
    return respond(
      error instanceof AppError && error.message !== "billingProviderUnavailable"
        ? error.status
        : 503,
    );
  }
}
