import { AppError } from "@/server/services/errors";
import { getSubscriptionPaymentConfig } from "./paymentConfig";
import {
  CHECK_SCRIPT,
  RESULT_SCRIPT,
  getPaymentCredentials,
  parsePaymentNotification,
  paymentAcknowledgement,
  scalar,
  verifyFreedomPay,
} from "./freedomPay";
import { applyVerifiedPayment, verifyInvoiceCanBePaid } from "./subscriptionPayments";
import { prisma } from "@/server/db/prisma";

export const handleFreedomPayNotification = async (request: Request, kind: "check" | "result") => {
  const config = getSubscriptionPaymentConfig();
  const script = kind === "check" ? CHECK_SCRIPT : RESULT_SCRIPT;
  const respond = (accepted: boolean, status: number) =>
    new Response(paymentAcknowledgement(script, config.secretKey, accepted), {
      status,
      headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store" },
    });
  if (!config.secretKey || !config.merchantId) return respond(false, 503);
  try {
    const fields = await parsePaymentNotification(request);
    verifyFreedomPay(script, fields, config.secretKey);
    const invoiceId = scalar(fields, "pg_order_id");
    if (!invoiceId || !/^[a-zA-Z0-9_-]{1,50}$/.test(invoiceId))
      throw new AppError("billingPaymentMismatch");
    const invoice = await prisma.subscriptionInvoice.findUnique({
      where: { id: invoiceId },
      select: { merchantId: true },
    });
    if (!invoice) throw new AppError("recordNotFound", "NOT_FOUND", 404);
    getPaymentCredentials(invoice.merchantId);
    if (kind === "check") await verifyInvoiceCanBePaid(invoiceId, fields);
    else await applyVerifiedPayment({ invoiceId, fields, source: "CALLBACK" });
    return respond(true, 200);
  } catch (error) {
    return respond(false, error instanceof AppError ? error.status : 503);
  }
};
