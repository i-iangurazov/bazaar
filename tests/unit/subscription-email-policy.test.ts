import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailDeliveryErrorCategory } from "@prisma/client";
import type * as PlanLimits from "@/server/services/planLimits";
const billing = vi.hoisted(() => ({ org: vi.fn(), access: vi.fn() }));
vi.mock("@/server/services/planLimits", async () => {
  const actual = await vi.importActual<typeof PlanLimits>("@/server/services/planLimits");
  return {
    ...actual,
    getOrganizationPlan: billing.org,
    resolveOrganizationAccessState: billing.access,
  };
});
import { prisma } from "@/server/db/prisma";
import { EmailProviderError } from "@/server/services/email";
import {
  emailRecipientCanBeCancelled,
  emailSubmissionOutcomeIsUncertain,
  isReservedBazaarSenderDomain,
  processEmailAutomationTrigger,
} from "@/server/services/emailMarketing";

afterEach(() => vi.restoreAllMocks());
describe("subscription mail policy", () => {
  it.each(["bazaar.kg", "BAZAAR.KG.", "mail.bazaar.kg", "a.mail.bazaar.kg", "www.bazaar.kg"])(
    "reserves the platform sender domain %s",
    (domain) => {
      expect(isReservedBazaarSenderDomain(domain)).toBe(true);
    },
  );
  it.each(["merchant.kg", "bazaar.kg.example.com", "notbazaar.kg"])(
    "allows a merchant domain %s",
    (domain) => {
      expect(isReservedBazaarSenderDomain(domain)).toBe(false);
    },
  );
  it("holds quota when a successful provider ACK is followed by a local database failure", () => {
    expect(
      emailSubmissionOutcomeIsUncertain({
        providerAttempted: true,
        providerAcknowledged: true,
        error: new Error("synthetic database commit failure"),
      }),
    ).toBe(true);
  });
  it.each([408, 500, 503])("holds quota after ambiguous provider status %s", (status) => {
    expect(
      emailSubmissionOutcomeIsUncertain({
        providerAttempted: true,
        providerAcknowledged: false,
        error: new EmailProviderError({ provider: "resend", status, responseText: "synthetic" }),
      }),
    ).toBe(true);
  });
  it.each([400, 401, 403, 422, 429])("recognizes explicit preaccept rejection %s", (status) => {
    expect(
      emailSubmissionOutcomeIsUncertain({
        providerAttempted: true,
        providerAcknowledged: false,
        error: new EmailProviderError({ provider: "resend", status, responseText: "synthetic" }),
      }),
    ).toBe(false);
  });
  it("keeps an earlier uncertain submission held after a later explicit rejection", () => {
    expect(
      emailSubmissionOutcomeIsUncertain({
        providerAttempted: true,
        providerAcknowledged: false,
        priorUncertain: true,
        error: new EmailProviderError({
          provider: "resend",
          status: 409,
          responseText: "idempotency payload conflict",
        }),
      }),
    ).toBe(true);
  });
  it("never consumes quota for a failure before any provider attempt", () => {
    expect(
      emailSubmissionOutcomeIsUncertain({
        providerAttempted: false,
        providerAcknowledged: false,
        error: new Error("configuration"),
      }),
    ).toBe(false);
  });
  it("cancels unsubmitted recipients but preserves ambiguous retries", () => {
    expect(
      emailRecipientCanBeCancelled({
        providerOperationKey: null,
        normalizedErrorCategory: EmailDeliveryErrorCategory.NONE,
      }),
    ).toBe(true);
    expect(
      emailRecipientCanBeCancelled({
        providerOperationKey: "attempt",
        normalizedErrorCategory: EmailDeliveryErrorCategory.RATE_LIMIT,
      }),
    ).toBe(true);
    for (const category of [
      EmailDeliveryErrorCategory.UNKNOWN,
      EmailDeliveryErrorCategory.PROVIDER_TIMEOUT,
      EmailDeliveryErrorCategory.PROVIDER_TEMPORARY,
    ]) {
      expect(
        emailRecipientCanBeCancelled({
          providerOperationKey: "attempt",
          normalizedErrorCategory: category,
        }),
      ).toBe(false);
    }
  });
  it("skips ineligible new organizations without touching orders, automations or the provider", async () => {
    billing.org.mockResolvedValue({
      billingCatalogVersion: "2026-11",
      lifetimeAccess: false,
      entitlements: { features: { marketingAutomation: false } },
    });
    const find = vi
      .spyOn(prisma.emailAutomation, "findMany")
      .mockRejectedValue(new Error("must not read automation data"));
    await expect(
      processEmailAutomationTrigger({
        organizationId: "org",
        storeId: "store",
        customerOrderId: "order",
        trigger: "ORDER_CREATED",
      }),
    ).resolves.toEqual({ processed: 0, sent: 0, failed: 0, skipped: 0 });
    expect(find).not.toHaveBeenCalled();
  });
  it("skips expired new Enterprise without breaking the core order operation", async () => {
    billing.org.mockResolvedValue({
      billingCatalogVersion: "2026-11",
      lifetimeAccess: false,
      entitlements: { features: { marketingAutomation: true } },
    });
    billing.access.mockReturnValue({ hasAccess: false });
    const find = vi
      .spyOn(prisma.emailAutomation, "findMany")
      .mockRejectedValue(new Error("must not read automation data"));
    await expect(
      processEmailAutomationTrigger({
        organizationId: "org",
        storeId: "store",
        customerOrderId: "order",
        trigger: "ORDER_CREATED",
      }),
    ).resolves.toMatchObject({ processed: 0 });
    expect(find).not.toHaveBeenCalled();
  });
  it.each(["legacy", "lifetime"])("preserves existing %s automation eligibility", async (kind) => {
    billing.org.mockResolvedValue({
      billingCatalogVersion: kind === "legacy" ? "2026-10" : "2026-11",
      lifetimeAccess: kind === "lifetime",
      entitlements: { features: { marketingAutomation: false } },
    });
    const find = vi.spyOn(prisma.emailAutomation, "findMany").mockResolvedValue([]);
    await expect(
      processEmailAutomationTrigger({
        organizationId: "org",
        storeId: "store",
        customerOrderId: "order",
        trigger: "ORDER_CREATED",
      }),
    ).resolves.toMatchObject({ processed: 0 });
    expect(find).toHaveBeenCalledTimes(1);
  });
});
