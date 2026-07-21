import { describe, expect, it, vi } from "vitest";

import {
  buildHeldReceiptResumeHref,
  mergeMobilePosReceiptHistory,
  resolveMobilePosCompletionAttempt,
} from "@/lib/mobilePosState";

describe("mobile POS state", () => {
  it("builds an encoded deep link that resumes the selected held receipt", () => {
    expect(buildHeldReceiptResumeHref("register / 1", "receipt?2")).toBe(
      "/pos/sell?registerId=register%20%2F%201&receiptId=receipt%3F2&mode=resume",
    );
  });

  it("reuses the completion idempotency key until the same sale is confirmed", () => {
    const createIdempotencyKey = vi
      .fn<() => string>()
      .mockReturnValueOnce("completion-key-1")
      .mockReturnValueOnce("completion-key-2");

    const first = resolveMobilePosCompletionAttempt({
      current: null,
      saleId: "sale-1",
      createIdempotencyKey,
    });
    const retry = resolveMobilePosCompletionAttempt({
      current: first,
      saleId: "sale-1",
      createIdempotencyKey,
    });
    const nextSale = resolveMobilePosCompletionAttempt({
      current: retry,
      saleId: "sale-2",
      createIdempotencyKey,
    });

    expect(retry).toBe(first);
    expect(retry.idempotencyKey).toBe("completion-key-1");
    expect(nextSale.idempotencyKey).toBe("completion-key-2");
    expect(createIdempotencyKey).toHaveBeenCalledTimes(2);
  });

  it("merges immediately fetched held receipts into mobile history without duplicates", () => {
    const completed = [{ id: "completed-1", createdAt: "2026-07-20T10:00:00.000Z", isHeld: false }];
    const held = [
      { id: "held-1", createdAt: "2026-07-20T10:01:00.000Z", isHeld: true },
      { id: "completed-1", createdAt: "2026-07-20T10:00:00.000Z", isHeld: false },
    ];

    expect(mergeMobilePosReceiptHistory(completed, held).map((item) => item.id)).toEqual([
      "held-1",
      "completed-1",
    ]);
  });
});
