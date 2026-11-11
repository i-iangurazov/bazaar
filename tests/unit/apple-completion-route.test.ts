import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ challenge: vi.fn(), complete: vi.fn(), consume: vi.fn(), token: vi.fn() }));
vi.mock("@/server/billing/appleNativeCompletion", () => ({ createAppleCompletionChallenge: mocks.challenge, completeAppleNativeOutcome: mocks.complete }));
vi.mock("@/server/middleware/rateLimiter", () => ({ createRateLimiter: () => ({ consume: mocks.consume }) }));
vi.mock("@/server/auth/token", () => ({ getServerAuthToken: mocks.token }));
import { appleCompletionRoute } from "@/server/billing/appleCompletionRoute";
const challengeBody = { intentId: "synthetic-intent", attemptId: "11111111-1111-4111-8111-111111111111", keyFingerprint: "a".repeat(64), outcome: "CANCELED" };
const request = (body: object, origin = "https://www.bazaar.kg") => new Request("https://www.bazaar.kg/api/billing/apple/native/completion", {
  method: "POST", headers: { origin, "X-Bazaar-Native-App": "kg.bazaar.app", "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.consume.mockResolvedValue(undefined); });
describe("completion capability REST boundary", () => {
  it("works without a user session and exposes only the opaque challenge for the enrolled original scope", async () => {
    mocks.challenge.mockResolvedValue({ challenge: "opaque-device-key-challenge", expiresAt: "2026-11-11T00:05:00Z" });
    const response = await appleCompletionRoute(request(challengeBody), "challenge");
    expect(response.status).toBe(200); expect(mocks.challenge).toHaveBeenCalledWith(challengeBody, "https://www.bazaar.kg");
    expect(mocks.token).not.toHaveBeenCalled(); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(await response.json()).sort()).toEqual(["challenge", "expiresAt"]);
  });
  it.each([{ ...challengeBody, organizationId: "another-tenant" }, { ...challengeBody, outcome: "CANCELED", transactionDigest: "b".repeat(64) },
    { ...challengeBody, outcome: "DEFERRED" }, { ...challengeBody, attemptId: "invalid" }])("rejects ambiguous or caller-selected completion scope", async (body) => {
    expect((await appleCompletionRoute(request(body), "challenge")).status).toBe(400); expect(mocks.challenge).not.toHaveBeenCalled();
  });
  it("keeps money ACK distinct and rejects foreign origins before proof processing", async () => {
    const body = { challenge: "synthetic-opaque-challenge".repeat(2), signature: Buffer.alloc(64).toString("base64") };
    mocks.complete.mockResolvedValue({ acknowledged: true, kind: "RECORDED", recorded: true, status: "REVIEW", reason: "applePaymentNeedsReview" });
    const response = await appleCompletionRoute(request(body), "complete");
    expect(await response.json()).toMatchObject({ kind: "RECORDED", status: "REVIEW" });
    expect(mocks.token).not.toHaveBeenCalled(); mocks.complete.mockClear();
    expect((await appleCompletionRoute(request(body, "https://different-preview.vercel.app"), "complete")).status).toBe(403);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("limits anonymous requests without echoing sensitive proof", async () => {
    mocks.consume.mockRejectedValue(new Error("rateLimited"));
    const response = await appleCompletionRoute(request(challengeBody), "challenge");
    expect(response.status).toBe(429); expect(await response.json()).toEqual({ error: "rateLimited" });
    expect(mocks.challenge).not.toHaveBeenCalled();
  });
});
