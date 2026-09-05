import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/server/logging", () => ({ getLogger: () => log }));
vi.mock("@/server/config/runtime", () => ({
  isProductionRuntime: () => false,
  assertExternalProviderCallAllowed: vi.fn(),
}));

import { EmailProviderError, sendTransactionalEmail } from "@/server/services/email";

const payload = {
  to: "synthetic@example.test",
  subject: "Synthetic subject",
  text: "Private token",
  html: "<p>Private token</p>",
};
const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });
const observe = <T>(promise: Promise<T>) => {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  void promise.then(
    (value) => {
      state.settled = true;
      state.value = value;
    },
    (error) => {
      state.settled = true;
      state.error = error;
    },
  );
  return state;
};

describe("transactional email transport reliability", () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "synthetic-provider-key");
    vi.stubEnv("EMAIL_FROM", "test@example.test");
    vi.stubGlobal("fetch", fetch);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("requires a provider message ID before reporting an accepted send", async () => {
    fetch.mockResolvedValue(json({ id: "synthetic-message-id" }));
    expect(await sendTransactionalEmail(payload)).toEqual({
      provider: "resend",
      id: "synthetic-message-id",
    });
  });

  it.each([{}, { id: "" }, { id: 7 }, { error: "unexpected" }])(
    "rejects malformed successful response %j instead of inventing acceptance",
    async (body) => {
      fetch.mockResolvedValue(json(body));
      await expect(sendTransactionalEmail(payload)).rejects.toMatchObject({
        message: "emailProviderInvalidResponse",
      });
    },
  );

  it("uses one generated idempotency key and identical payload across a rate-limit retry", async () => {
    fetch.mockResolvedValueOnce(json({ message: "limited" }, 429, { "Retry-After": "1" }));
    fetch.mockResolvedValueOnce(json({ id: "synthetic-retry" }));
    const state = observe(sendTransactionalEmail(payload));
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.value).toEqual({ provider: "resend", id: "synthetic-retry" });
    const calls = fetch.mock.calls;
    const first = new Headers(calls[0][1]?.headers).get("Idempotency-Key");
    expect(first).toEqual(expect.any(String));
    expect(first!.length).toBeGreaterThan(0);
    expect(new Headers(calls[1][1]?.headers).get("Idempotency-Key")).toBe(first);
    expect(calls[1][1]?.body).toBe(calls[0][1]?.body);
  });

  it("recovers a transient provider failure with the caller's stable key", async () => {
    fetch.mockResolvedValueOnce(json({ message: "unavailable" }, 503));
    fetch.mockResolvedValueOnce(json({ id: "synthetic-recovered" }));
    const state = observe(
      sendTransactionalEmail({ ...payload, idempotencyKey: "owned-operation-key" }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.value).toEqual({ provider: "resend", id: "synthetic-recovered" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      fetch.mock.calls.every(
        (call) => new Headers(call[1]?.headers).get("Idempotency-Key") === "owned-operation-key",
      ),
    ).toBe(true);
  });

  it("retries a lost network response with the same operation identity", async () => {
    fetch.mockRejectedValueOnce(new TypeError("private provider URL and recipient"));
    fetch.mockResolvedValueOnce(json({ id: "network-recovered" }));
    const state = observe(sendTransactionalEmail(payload));
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.value).toEqual({ provider: "resend", id: "network-recovered" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Headers(fetch.mock.calls[1][1]?.headers).get("Idempotency-Key")).toBe(
      new Headers(fetch.mock.calls[0][1]?.headers).get("Idempotency-Key"),
    );
  });

  it("stops after three transient failures and leaves no retry timer running", async () => {
    fetch.mockImplementation(async () => json({ message: "temporarily unavailable" }, 503));
    const state = observe(sendTransactionalEmail(payload));
    await vi.advanceTimersByTimeAsync(15001);
    expect(state.error).toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps recipient/link/provider-body data out of serialized errors and messages", async () => {
    const privateText = "private@example.test https://app.example.test/reset/private-token";
    fetch.mockResolvedValue(json({ message: privateText }, 422));
    const state = observe(sendTransactionalEmail(payload));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.error).toBeInstanceOf(EmailProviderError);
    expect(String(state.error)).not.toContain(privateText);
    expect(JSON.stringify(state.error)).not.toContain(privateText);
    expect((state.error as EmailProviderError).providerMessage).toBe(privateText);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["request", "body"])(
    "bounds a hung %s even when the mock ignores cancellation",
    async (phase) => {
      if (phase === "request") fetch.mockImplementation(() => new Promise(() => {}));
      else
        fetch.mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: () => new Promise(() => {}),
          json: () => new Promise(() => {}),
        } as Response);
      const state = observe(sendTransactionalEmail(payload));
      await vi.advanceTimersByTimeAsync(15001);
      expect(state.settled).toBe(true);
      expect(state.error).toMatchObject({ message: "emailProviderTimeout" });
      expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    },
  );

  it("does not wait indefinitely or retry too early when Retry-After exceeds its request budget", async () => {
    fetch.mockResolvedValue(json({ message: "limited" }, 429, { "Retry-After": "3600" }));
    const state = observe(sendTransactionalEmail(payload));
    await vi.advanceTimersByTimeAsync(15001);
    expect(state.settled).toBe(true);
    expect(state.error).toMatchObject({ status: 429, retryAfterMs: 3600000 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("honors an HTTP-date Retry-After within the bounded budget", async () => {
    fetch.mockResolvedValueOnce(json({}, 429, { "Retry-After": "Sat, 05 Sep 2026 12:00:02 GMT" }));
    fetch.mockResolvedValueOnce(json({ id: "after-date" }));
    const state = observe(sendTransactionalEmail(payload));
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.value).toEqual({ provider: "resend", id: "after-date" });
  });
});
