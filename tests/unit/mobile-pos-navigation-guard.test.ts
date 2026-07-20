import { PosPaymentMethod } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { hasMobilePosNavigationRisk } from "@/lib/mobilePosNavigationGuard";
import { createDefaultPosPaymentDraft } from "@/lib/posPaymentDrafts";

const emptyState = () => ({
  cartLineCount: 0,
  payments: [createDefaultPosPaymentDraft()],
  discountKgs: 0,
  comment: "",
  hasCustomer: false,
  sellInDebt: false,
});

describe("mobile POS navigation guard", () => {
  it("does not block back navigation for a genuinely empty receipt", () => {
    expect(hasMobilePosNavigationRisk(emptyState())).toBe(false);
  });

  it("blocks back navigation for cart, payment, or unsaved receipt changes", () => {
    expect(hasMobilePosNavigationRisk({ ...emptyState(), cartLineCount: 1 })).toBe(true);
    expect(
      hasMobilePosNavigationRisk({
        ...emptyState(),
        payments: [
          createDefaultPosPaymentDraft(),
          { method: PosPaymentMethod.CARD, amount: "10", providerRef: "" },
        ],
      }),
    ).toBe(true);
    expect(hasMobilePosNavigationRisk({ ...emptyState(), discountKgs: 5 })).toBe(true);
    expect(hasMobilePosNavigationRisk({ ...emptyState(), comment: "Hold for customer" })).toBe(
      true,
    );
    expect(hasMobilePosNavigationRisk({ ...emptyState(), hasCustomer: true })).toBe(true);
  });
});
