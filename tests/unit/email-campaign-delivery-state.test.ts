import { describe, expect, it } from "vitest";

import {
  canRetryEmailProviderOperation,
  canonicalEmailEventTypeForProviderLookup,
  isEmailProviderOperationExpired,
} from "@/server/services/emailCampaignDeliveryState";

describe("email campaign durable provider operations", () => {
  it("canonicalizes lookup-only engagement to delivered for reconciliation", () => {
    expect(canonicalEmailEventTypeForProviderLookup("opened")).toBe("email.delivered");
    expect(canonicalEmailEventTypeForProviderLookup("clicked")).toBe("email.delivered");
    expect(canonicalEmailEventTypeForProviderLookup("bounced")).toBe("email.bounced");
  });

  it("uses provider operation start rather than old recipient creation time", () => {
    const now = new Date("2026-07-27T12:00:00.000Z");
    expect(
      isEmailProviderOperationExpired({
        providerOperationStartedAt: new Date("2026-07-27T11:59:00.000Z"),
        lastUpdatedAt: new Date("2025-01-01T00:00:00.000Z"),
        now,
      }),
    ).toBe(false);
  });

  it("refuses an ambiguous manual retry after the provider idempotency window", () => {
    const now = new Date("2026-07-27T12:00:00.000Z");
    expect(
      canRetryEmailProviderOperation({
        providerOperationKey: "email-campaign-operation",
        providerOperationStartedAt: new Date("2026-07-26T12:00:00.000Z"),
        now,
      }),
    ).toBe(false);
    expect(
      canRetryEmailProviderOperation({
        providerOperationKey: "email-campaign-operation",
        providerOperationStartedAt: new Date("2026-07-27T11:00:00.000Z"),
        now,
      }),
    ).toBe(true);
    expect(
      canRetryEmailProviderOperation({
        providerOperationKey: null,
        providerOperationStartedAt: null,
        now,
      }),
    ).toBe(true);
  });
});
