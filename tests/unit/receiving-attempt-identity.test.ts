import { describe, expect, it } from "vitest";
import { isCurrentReceivingAttempt, type OwnedReceivingAttempt } from "@/components/inventory/receiving-attempt-identity";
import type { ReviewedStockReceiving } from "@/lib/stockReceivingCommerce";

const request: ReviewedStockReceiving = {
  idempotencyKey: "receiving-attempt-one",
  token: "signed-frozen-review-one",
  receiving: { storeId: "store-one", lines: [{ productId: "product-one", variantId: null, quantity: 10, unitCost: 200 }] },
};
const owner = { organizationId: "organization-one", userId: "user-one" };
const active: OwnedReceivingAttempt = { request, owner };

describe("receiving asynchronous operation ownership", () => {
  it("accepts the exact frozen attempt after a network round trip", () => {
    expect(isCurrentReceivingAttempt(structuredClone(request), active, { ...owner })).toBe(true);
  });

  it("leaves the new owner's pending operation intact after a late old success, error or recovery", () => {
    const nextOwner = { organizationId: "organization-two", userId: "user-two" };
    const next: OwnedReceivingAttempt = {
      owner: nextOwner,
      request: { ...request, idempotencyKey: "receiving-attempt-two", token: "signed-frozen-review-two" },
    };
    let pending: OwnedReceivingAttempt | null = next;
    let notifications = 0;
    for (const result of ["success", "error", "recovery"]) {
      if (isCurrentReceivingAttempt(request, pending, nextOwner)) {
        pending = null;
        notifications += result.length;
      }
    }
    expect(pending).toEqual(next);
    expect(notifications).toBe(0);
  });

  it("rejects the old attempt as soon as authentication changes, before restoration effects run", () => {
    expect(isCurrentReceivingAttempt(request, active, null)).toBe(false);
    expect(isCurrentReceivingAttempt(request, active, { ...owner, userId: "another-user" })).toBe(false);
    expect(isCurrentReceivingAttempt(request, active, { ...owner, organizationId: "another-org" })).toBe(false);
  });

  it("does not let an older attempt clear a newer operation of the same user or a different frozen payload", () => {
    expect(isCurrentReceivingAttempt(request, { owner, request: { ...request, idempotencyKey: "receiving-attempt-two" } }, owner)).toBe(false);
    expect(isCurrentReceivingAttempt(request, { owner, request: { ...request, token: "another-review" } }, owner)).toBe(false);
    expect(isCurrentReceivingAttempt(request, { owner, request: { ...request, receiving: { ...request.receiving, storeId: "another-store" } } }, owner)).toBe(false);
  });

  it("prevents a completed operation from navigating or notifying a different account after cache refresh", () => {
    const settled = structuredClone(active);
    expect(isCurrentReceivingAttempt(request, settled, owner)).toBe(true);
    expect(isCurrentReceivingAttempt(request, settled, { ...owner, userId: "new-owner" })).toBe(false);
    expect(isCurrentReceivingAttempt(request, null, owner)).toBe(false);
  });
});
