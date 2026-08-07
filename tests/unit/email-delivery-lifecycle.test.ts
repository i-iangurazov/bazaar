import { describe, expect, it } from "vitest";

import {
  buildEmailProviderEventIdentity,
  countEmailRecipientLifecycleStatuses,
  decideEmailRecipientTransition,
  isRetryableEmailDeliveryFailure,
  lifecycleStatusForProviderEvent,
  lifecycleStatusForProviderLookup,
  normalizeEmailDeliveryError,
  resolveEmailCampaignLifecycleStatus,
  summarizeLegacyEmailCampaignRecipients,
  type EmailRecipientLifecycleStatus,
  type LegacyEmailCampaignRecipient,
} from "@/server/services/emailDeliveryLifecycle";

describe("email delivery lifecycle", () => {
  it("accounts for the incident-sized safe equivalent without losing recipients", () => {
    const recipients: LegacyEmailCampaignRecipient[] = Array.from(
      { length: 3_960 },
      (_value, index) => {
        if (index < 31) {
          return {
            status: "SENT",
            sentAt: new Date("2026-07-17T00:00:00.000Z"),
            deliveredAt: new Date("2026-07-17T00:01:00.000Z"),
            providerStatus: "delivered",
          };
        }
        if (index < 31 + 161) {
          return {
            status: "FAILED",
            sentAt: new Date("2026-07-17T00:00:00.000Z"),
            bouncedAt: new Date("2026-07-17T00:02:00.000Z"),
            providerStatus: "bounced",
          };
        }
        return {
          status: "SENT",
          sentAt: new Date("2026-07-17T00:00:00.000Z"),
          providerStatus: "sent",
        };
      },
    );

    const summary = summarizeLegacyEmailCampaignRecipients(recipients);
    expect(summary).toMatchObject({
      audience: 3_960,
      ACCEPTED: 3_768,
      DELIVERED: 31,
      BOUNCED: 161,
      unresolved: 3_768,
      invariantTotal: 3_960,
      invariantSatisfied: true,
    });
    expect(resolveEmailCampaignLifecycleStatus(summary)).toBe("AWAITING_EVENTS");
  });

  it("maps Resend delivery and engagement events to their durable lifecycle states", () => {
    expect(lifecycleStatusForProviderEvent("email.sent")).toBe("ACCEPTED");
    expect(lifecycleStatusForProviderEvent("email.delivery_delayed")).toBe("DEFERRED");
    expect(lifecycleStatusForProviderEvent("email.suppressed")).toBe("SUPPRESSED");
    expect(lifecycleStatusForProviderEvent("email.opened")).toBe("DELIVERED");
    expect(lifecycleStatusForProviderEvent("email.clicked")).toBe("DELIVERED");
    expect(lifecycleStatusForProviderLookup("opened")).toBe("DELIVERED");
    expect(lifecycleStatusForProviderLookup("clicked")).toBe("DELIVERED");
  });

  it("builds a provider-scoped deterministic identity when no event id exists", () => {
    const input = {
      provider: "resend",
      providerMessageId: "message-1",
      eventType: "email.delivered",
      eventAt: new Date("2026-07-17T00:00:00.000Z"),
    };
    expect(buildEmailProviderEventIdentity(input)).toBe(buildEmailProviderEventIdentity(input));
    expect(buildEmailProviderEventIdentity({ ...input, eventType: "email.bounced" })).not.toBe(
      buildEmailProviderEventIdentity(input),
    );
    expect(
      buildEmailProviderEventIdentity({ ...input, providerEventId: "evt-1" }),
    ).toBe("resend:evt-1");
  });

  it("ignores duplicate and out-of-order events", () => {
    const currentEventAt = new Date("2026-07-17T00:02:00.000Z");
    expect(
      decideEmailRecipientTransition({
        currentStatus: "DELIVERED",
        currentEventAt,
        currentEventIdentity: "resend:evt-delivered",
        eventStatus: "DELIVERED",
        eventAt: currentEventAt,
        eventIdentity: "resend:evt-delivered",
      }),
    ).toMatchObject({ apply: false, reason: "duplicate_event", nextStatus: "DELIVERED" });

    expect(
      decideEmailRecipientTransition({
        currentStatus: "DELIVERED",
        currentEventAt,
        eventStatus: "ACCEPTED",
        eventAt: new Date("2026-07-17T00:01:00.000Z"),
        eventIdentity: "resend:evt-sent",
      }),
    ).toMatchObject({ apply: false, reason: "older_event", nextStatus: "DELIVERED" });

    expect(
      decideEmailRecipientTransition({
        currentStatus: "BOUNCED",
        currentEventAt,
        eventStatus: "DELIVERED",
        eventAt: new Date("2026-07-17T00:03:00.000Z"),
        eventIdentity: "resend:evt-impossible-delivery",
      }),
    ).toMatchObject({
      apply: false,
      reason: "terminal_state_regression",
      nextStatus: "BOUNCED",
    });
  });

  it("allows the provider-defined delivered then complained sequence", () => {
    expect(
      decideEmailRecipientTransition({
        currentStatus: "DELIVERED",
        currentEventAt: new Date("2026-07-17T00:02:00.000Z"),
        eventStatus: "COMPLAINED",
        eventAt: new Date("2026-07-17T01:00:00.000Z"),
        eventIdentity: "resend:evt-complained",
      }),
    ).toEqual({ apply: true, reason: "applied", nextStatus: "COMPLAINED" });
  });

  it("retries only transient failures", () => {
    const cases: Array<{
      status: EmailRecipientLifecycleStatus;
      httpStatus?: number;
      reason?: string;
      expected: boolean;
    }> = [
      { status: "FAILED", httpStatus: 429, expected: true },
      { status: "FAILED", httpStatus: 503, expected: true },
      { status: "FAILED", reason: "provider timeout", expected: true },
      { status: "FAILED", reason: "fetch failed: socket closed", expected: true },
      { status: "DEFERRED", reason: "mailbox temporarily unavailable", expected: true },
      { status: "BOUNCED", reason: "unknown user", expected: false },
      { status: "SUPPRESSED", reason: "suppression list", expected: false },
      { status: "COMPLAINED", reason: "spam complaint", expected: false },
      { status: "FAILED", httpStatus: 400, reason: "invalid request", expected: false },
    ];

    for (const testCase of cases) {
      const category = normalizeEmailDeliveryError({
        status: testCase.status,
        providerHttpStatus: testCase.httpStatus,
        reason: testCase.reason,
      });
      expect(
        isRetryableEmailDeliveryFailure({ status: testCase.status, category }),
        `${testCase.status}/${category}`,
      ).toBe(testCase.expected);
    }
  });

  it("derives all campaign lifecycle outcomes from exclusive recipient states", () => {
    const status = (values: EmailRecipientLifecycleStatus[]) =>
      resolveEmailCampaignLifecycleStatus(countEmailRecipientLifecycleStatuses(values));

    expect(status(["QUEUED", "QUEUED"])).toBe("QUEUED");
    expect(status(["SENDING", "QUEUED"])).toBe("SENDING");
    expect(status(["ACCEPTED", "DEFERRED"])).toBe("AWAITING_EVENTS");
    expect(status(["DELIVERED", "DELIVERED"])).toBe("COMPLETED");
    expect(status(["DELIVERED", "BOUNCED"])).toBe("COMPLETED_WITH_ERRORS");
    expect(status(["BOUNCED", "FAILED"])).toBe("FAILED");
    expect(status(["CANCELLED", "CANCELLED"])).toBe("CANCELLED");
  });
});
