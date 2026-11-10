import type { ReviewedStockReceiving } from "@/lib/stockReceivingCommerce";
import type { ReceivingDraftIdentity } from "./receiving-draft-storage";

export type ReceivingAttemptOwner = Omit<ReceivingDraftIdentity, "storeId">;
export type OwnedReceivingAttempt = {
  request: ReviewedStockReceiving;
  owner: ReceivingAttemptOwner;
};

// Mutation callbacks may outlive an account change or a newer operation. Only
// the currently authenticated owner of this exact frozen attempt may affect UI.
export const isCurrentReceivingAttempt = (
  request: ReviewedStockReceiving,
  active: OwnedReceivingAttempt | null,
  authenticatedOwner: ReceivingAttemptOwner | null,
) => Boolean(
  active && authenticatedOwner &&
  active.owner.organizationId === authenticatedOwner.organizationId &&
  active.owner.userId === authenticatedOwner.userId &&
  active.request.idempotencyKey === request.idempotencyKey &&
  active.request.token === request.token &&
  JSON.stringify(active.request.receiving) === JSON.stringify(request.receiving),
);
