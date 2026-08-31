import { CustomerOrderStatus, RegisterShiftStatus, Role } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { resolvePosPaymentCorrectionEligibility } from "@/server/services/pos";

const userFor = (role: Role) => ({
  id: `user-${role.toLowerCase()}`,
  organizationId: "org-payment-correction",
  role,
  isOrgOwner: false,
  isPlatformOwner: false,
});

const eligibleInput = {
  status: CustomerOrderStatus.COMPLETED,
  isDebt: false,
  shiftId: "shift-open",
  shiftStatus: RegisterShiftStatus.OPEN,
  registerActive: true,
  kkmStatus: "NOT_SENT" as const,
  fiscalReceiptCount: 0,
};

describe("POS completed-payment correction eligibility", () => {
  it.each([Role.ADMIN, Role.MANAGER, Role.CASHIER])(
    "allows %s to use the same safe correction workflow",
    (role) => {
      expect(
        resolvePosPaymentCorrectionEligibility({ ...eligibleInput, user: userFor(role) }),
      ).toEqual({ eligible: true, reason: "ELIGIBLE" });
    },
  );

  it("rejects STAFF even though ordinary POS entry is available", () => {
    expect(
      resolvePosPaymentCorrectionEligibility({ ...eligibleInput, user: userFor(Role.STAFF) }),
    ).toEqual({ eligible: false, reason: "ROLE_REQUIRED" });
  });

  it("allows a non-fiscal correction after the original shift is closed", () => {
    expect(
      resolvePosPaymentCorrectionEligibility({
        ...eligibleInput,
        shiftStatus: RegisterShiftStatus.CLOSED,
        user: userFor(Role.CASHIER),
      }),
    ).toEqual({ eligible: true, reason: "ELIGIBLE" });
  });

  it("keeps fiscal receipts immutable", () => {
    expect(
      resolvePosPaymentCorrectionEligibility({
        ...eligibleInput,
        kkmStatus: "SENT",
        fiscalReceiptCount: 1,
        user: userFor(Role.CASHIER),
      }),
    ).toEqual({ eligible: false, reason: "FISCAL_CORRECTION_REQUIRED" });
  });
});
