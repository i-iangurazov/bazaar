import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/logging", () => ({ getLogger: () => ({ error: vi.fn() }) }));
import { EmailProviderError } from "@/server/services/email";
import { AppError } from "@/server/services/errors";
import {
  loyaltyAuthErrorResponse,
  loyaltyDeliveryFailureReason,
} from "@/server/services/loyalty/authErrors";

describe("loyalty auth error boundaries", () => {
  it.each([
    ["The example.invalid domain is not verified", "sender_domain_not_verified"],
    ["You can only send testing emails to your own email address", "sender_testing_only"],
    ["API key is suspended", "provider_suspended"],
    ["Monthly quota exceeded", "provider_quota"],
    ["API key is not active", "provider_credentials"],
    ["Rejected private@example.invalid 123456", "provider_rejected"],
  ])("reduces %s to a bounded diagnostic", (message, reason) => {
    expect(
      loyaltyDeliveryFailureReason(
        new EmailProviderError({
          provider: "resend",
          status: 403,
          providerMessage: message,
          responseText: message,
        }),
      ),
    ).toBe(reason);
  });

  it("keeps unknown error bodies and infrastructure details out of public responses", async () => {
    const response = loyaltyAuthErrorResponse(
      new Error("private@example.invalid code=123456 database connection"),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: "loyaltyAuthUnavailable" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns safe delivery and verification errors with their real HTTP status", async () => {
    const response = loyaltyAuthErrorResponse(
      new AppError("emailDeliveryFailed", "INTERNAL_SERVER_ERROR", 503),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: "emailDeliveryFailed" });
  });

  it.each([60, 600])(
    "exposes the bounded %s-second retry delay for request limits",
    async (retryAfterSeconds) => {
      const response = loyaltyAuthErrorResponse(
        new AppError("loyaltyOtpRateLimited", "TOO_MANY_REQUESTS", 429, { retryAfterSeconds }),
      );
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe(String(retryAfterSeconds));
      expect(await response.json()).toEqual({ message: "loyaltyOtpRateLimited" });
    },
  );
});
