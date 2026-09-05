import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/config/runtime", () => ({
  isProductionRuntime: () => false,
  assertExternalProviderCallAllowed: vi.fn(),
}));
import { EmailProviderError, sendTransactionalEmail } from "@/server/services/email";
import { resolveOrderEmailRetryAt } from "@/server/services/orderEmailRetry";

const now = new Date("2026-09-05T12:00:00Z");
const failure = (retryAfterMs: number | null) =>
  new EmailProviderError({
    provider: "resend",
    status: 429,
    responseText: "synthetic",
    retryAfterMs,
  });
const schedule = (error: unknown, attemptCount = 1, hasClaim = true) =>
  resolveOrderEmailRetryAt({
    error,
    attemptCount,
    hasClaim,
    now,
  });

describe("durable order email retry scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "synthetic-test-key");
    vi.stubEnv("EMAIL_FROM", "synthetic@example.invalid");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected synthetic provider call");
      }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(["3600", "Sat, 05 Sep 2026 13:00:00 GMT"])(
    "preserves the provider's one-hour delay across transport failure and durable scheduling: %s",
    async (retryAfter) => {
      const fetch = vi
        .mocked(globalThis.fetch)
        .mockResolvedValue(
          new Response(JSON.stringify({ message: "synthetic rate limit" }), {
            status: 429,
            headers: { "Retry-After": retryAfter },
          }),
        );
      const error = await sendTransactionalEmail({
        to: "synthetic@example.invalid",
        subject: "Never sent",
        text: "Synthetic",
        html: "Synthetic",
        idempotencyKey: "synthetic-owned-order-email",
      }).then(
        () => {
          throw new Error("Expected provider rejection");
        },
        (caught) => caught,
      );
      expect(error).toBeInstanceOf(EmailProviderError);
      expect(fetch).toHaveBeenCalledTimes(1);
      const retryAt = schedule(error);
      expect(retryAt).toEqual(new Date("2026-09-05T13:00:00Z"));
      expect(retryAt!.getTime()).toBeGreaterThan(new Date("2026-09-05T12:01:00Z").getTime());
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("keeps the larger local exponential backoff when the provider delay is shorter", () => {
    expect(schedule(failure(30_000), 3)).toEqual(new Date("2026-09-05T12:04:00Z"));
    expect(schedule(failure(600_000), 3)).toEqual(new Date("2026-09-05T12:10:00Z"));
  });

  it("retains the five-attempt budget and schedules only a claimed durable delivery", () => {
    expect(schedule(failure(3_600_000), 4)).toEqual(new Date("2026-09-05T13:00:00Z"));
    expect(schedule(failure(3_600_000), 5)).toBeNull();
    expect(schedule(failure(3_600_000), 1, false)).toBeNull();
  });

  it("uses normal backoff for a missing or invalid provider hint without creating an invalid date", () => {
    for (const hint of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(schedule(failure(hint))).toEqual(new Date("2026-09-05T12:01:00Z"));
    }
    expect(schedule(new Error("synthetic network failure"), 2)).toEqual(
      new Date("2026-09-05T12:02:00Z"),
    );
    expect(schedule(failure(Number.MAX_VALUE))).toBeNull();
  });
});
