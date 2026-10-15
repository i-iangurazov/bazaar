import { EmailProviderError } from "@/server/services/email";
import { AppError } from "@/server/services/errors";
import { getLogger } from "@/server/logging";

/** A bounded diagnostic category, never the provider's echoed recipient or code. */
export const loyaltyDeliveryFailureReason = (error: unknown) => {
  if (!(error instanceof EmailProviderError)) return "transport_or_configuration";
  const message = error.providerMessage ?? "";
  if (/domain.*not verified/i.test(message)) return "sender_domain_not_verified";
  if (/only send testing emails/i.test(message)) return "sender_testing_only";
  if (/suspend/i.test(message)) return "provider_suspended";
  if (/quota|limit.*exceed/i.test(message)) return "provider_quota";
  if (/api key|permission|scope/i.test(message)) return "provider_credentials";
  return "provider_rejected";
};

export const loyaltyAuthErrorResponse = (error: unknown) => {
  const known = error instanceof AppError;
  if (!known) getLogger().error({ event: "loyalty_auth_failed" }, "Loyalty authentication failed");
  return Response.json(
    { message: known ? error.message : "loyaltyAuthUnavailable" },
    {
      status: known ? error.status : 503,
      headers: {
        "Cache-Control": "no-store",
        ...(known && error.status === 429
          ? { "Retry-After": String(error.details?.retryAfterSeconds ?? 60) }
          : {}),
      },
    },
  );
};
