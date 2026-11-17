export type CorrectionDifferenceLabelKind =
  | "refundCanceled"
  | "refundPending"
  | "refundPaid"
  | "charge"
  | "none";

/**
 * Chooses the truthful label for a stored correction's net difference. A
 * correction keeps its recorded refund amount, but the money state belongs to
 * the linked manual refund request: an open request is still pending, a
 * resolved one has been paid, and a canceled one is no longer owed.
 * Corrections without a request (CASH, CARD and OTHER) settle immediately, so
 * their recorded positive refund is money already paid out rather than money
 * still to refund.
 */
export const correctionDifferenceLabelKind = (input: {
  refundRequestStatus?: string | null;
  refundKgs: number;
  chargeKgs: number;
}): CorrectionDifferenceLabelKind => {
  if (input.refundRequestStatus === "CANCELED") return "refundCanceled";
  if (input.refundKgs > 0) {
    if (input.refundRequestStatus === "OPEN") return "refundPending";
    return "refundPaid";
  }
  if (input.chargeKgs > 0) return "charge";
  return "none";
};
