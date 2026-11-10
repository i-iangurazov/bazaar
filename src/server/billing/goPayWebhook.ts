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
  let stage: "authentication" | "lookup" | "provider" | "application" = "authentication";
  let eventName: string | undefined;
  try {
    const event = parseGoPayWebhook(
      await readGoPayBody(request),
      {
        nonce: request.headers.get("GoPay-Nonce"),
        signature: request.headers.get("GoPay-Signature"),
      },
      secret,
    );
    eventName = event.event;
    if (event.ignored) {
      getLogger().info(
        { provider: "GOPAY", event: event.event, outcome: "acknowledged" },
        "payment webhook",
      );
      return respond(200);
    }
    // Immutable order identity routes independently of the currently selected provider.
    stage = "lookup";
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
    stage = "provider";
    const payment = await getGoPayStatus(
      {
        orderId: invoice.providerOrderId!,
        providerPaymentId: event.payment.paymentId,
        isTest: invoice.isTest,
      },
      getGoPayCredentials(invoice.merchantId),
    );
    const receipt = goPayReceipt(invoice, payment);
    stage = "application";
    if (subscription)
      await applySubscriptionReceipt({ invoiceId: invoice.id, receipt, source: "CALLBACK" });
    else await applyWhatsAppReceipt({ invoiceId: invoice.id, receipt, source: "CALLBACK" });
    getLogger().info(
      { provider: "GOPAY", event: event.event, isTest: invoice.isTest, outcome: "reconciled" },
      "payment webhook",
    );
    return respond(200);
  } catch (error) {
    // A provider read can fail after authenticating a perfectly valid delivery.
    // Distinguish an upstream outage from a malformed incoming request. GoPay
    // retries every non-2xx response; neither path acknowledges a payment.
    const status =
      stage === "provider" ||
      !(error instanceof AppError) ||
      error.message === "billingProviderUnavailable"
        ? 503
        : error.status;
    getLogger().warn(
      { provider: "GOPAY", event: eventName, stage, status, outcome: "not_acknowledged" },
      "payment webhook",
    );
    return respond(status);
  }
}
