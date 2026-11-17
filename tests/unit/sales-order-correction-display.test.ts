import { describe, expect, it } from "vitest";

import { correctionDifferenceLabelKind } from "@/lib/salesOrderCorrectionDisplay";

describe("correction difference label", () => {
  it("marks a canceled transfer refund as canceled instead of money to refund", () => {
    expect(
      correctionDifferenceLabelKind({
        refundRequestStatus: "CANCELED",
        refundKgs: 100,
        chargeKgs: 0,
      }),
    ).toBe("refundCanceled");
  });

  it("distinguishes a pending payout from a confirmed one", () => {
    expect(
      correctionDifferenceLabelKind({
        refundRequestStatus: "OPEN",
        refundKgs: 100,
        chargeKgs: 0,
      }),
    ).toBe("refundPending");
    expect(
      correctionDifferenceLabelKind({
        refundRequestStatus: "RESOLVED",
        refundKgs: 100,
        chargeKgs: 0,
      }),
    ).toBe("refundPaid");
  });

  it("treats CASH, CARD and OTHER refunds without a request as already paid", () => {
    expect(
      correctionDifferenceLabelKind({
        refundRequestStatus: undefined,
        refundKgs: 100,
        chargeKgs: 0,
      }),
    ).toBe("refundPaid");
    expect(
      correctionDifferenceLabelKind({
        refundRequestStatus: null,
        refundKgs: 100,
        chargeKgs: 0,
      }),
    ).toBe("refundPaid");
    expect(
      correctionDifferenceLabelKind({
        refundRequestStatus: undefined,
        refundKgs: 0,
        chargeKgs: 50,
      }),
    ).toBe("charge");
    expect(
      correctionDifferenceLabelKind({
        refundRequestStatus: null,
        refundKgs: 0,
        chargeKgs: 0,
      }),
    ).toBe("none");
  });
});
