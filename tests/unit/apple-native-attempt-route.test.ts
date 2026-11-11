import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/services/errors";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), cancel: vi.fn(), acknowledge: vi.fn(),
  token: vi.fn(), impersonating: false }));
vi.mock("@/server/billing/applePayments", () => ({ authorizeApplePurchase: mocks.authorize,
  cancelApplePurchaseIntent: mocks.cancel, acknowledgeApplePurchase: mocks.acknowledge }));
vi.mock("@/server/auth/token", () => ({ getServerAuthToken: mocks.token }));
vi.mock("next/headers", () => ({ cookies: async () => ({ has: () => mocks.impersonating }) }));
import { appleNativeRoute } from "@/server/billing/appleNativeRoute";

const actor = { id: "synthetic-original-payer", organizationId: "synthetic-organization" };
const intentId = "synthetic-native-intent";
const request = (body: object, origin = "https://www.bazaar.kg") => new Request("https://www.bazaar.kg/api/billing/apple/native/authorize", {
  method: "POST", headers: { origin, "X-Bazaar-Native-App": "kg.bazaar.app", "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.impersonating = false;
  mocks.token.mockResolvedValue({ sub: actor.id, organizationId: actor.organizationId, role: "ADMIN" });
});

describe("native purchase attempt REST boundary", () => {
  it.each([{ intentId }, { intentId, attemptId: "invalid" }, { intentId, attemptId: randomUUID(), environment: "Production" },
    { intentId, prepareOnly: true, attemptId: randomUUID() }])("rejects missing, invalid or ambiguous final attempt authorization", async (body) => {
    expect((await appleNativeRoute(request(body), "authorize")).status).toBe(400);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it("prepares metadata without an attempt and forwards final UUID only to the authenticated original actor", async () => {
    mocks.authorize.mockResolvedValueOnce({ intentId, attemptId: null, environment: "Sandbox" });
    const prepared = await appleNativeRoute(request({ intentId, prepareOnly: true }), "authorize");
    expect(prepared.status).toBe(200); expect((await prepared.json()).attemptId).toBeNull();
    expect(mocks.authorize).toHaveBeenLastCalledWith(actor, intentId, { prepareOnly: true, attemptId: undefined });
    const attemptId = randomUUID();
    mocks.authorize.mockResolvedValueOnce({ intentId, attemptId, environment: "Sandbox" });
    const authorized = await appleNativeRoute(request({ intentId, attemptId }), "authorize");
    expect(authorized.status).toBe(200); expect((await authorized.json()).attemptId).toBe(attemptId);
    expect(authorized.headers.get("cache-control")).toBe("no-store");
    expect(mocks.authorize).toHaveBeenLastCalledWith(actor, intentId, { prepareOnly: undefined, attemptId });
  });

  it("passes cancellation UUID to the server and reports recorded money distinctly", async () => {
    const attemptId = randomUUID(); mocks.cancel.mockResolvedValue({ canceled: false, recorded: true });
    const response = await appleNativeRoute(request({ intentId, attemptId }), "cancel");
    expect(mocks.cancel).toHaveBeenCalledWith(actor, intentId, attemptId);
    expect(await response.json()).toEqual({ canceled: false, recorded: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns the mismatch conflict without disclosing the winning attempt or erasing its obligation", async () => {
    mocks.cancel.mockRejectedValue(new AppError("applePurchaseAttemptMismatch", "CONFLICT", 409));
    const response = await appleNativeRoute(request({ intentId, attemptId: randomUUID() }), "cancel");
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "applePurchaseAttemptMismatch" });
  });

  it("retains the no-attempt route for a soft intent while still enforcing origin and impersonation", async () => {
    mocks.cancel.mockResolvedValue({ canceled: true, recorded: false });
    expect((await appleNativeRoute(request({ intentId }), "cancel")).status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith(actor, intentId, undefined);
    mocks.cancel.mockClear();
    expect((await appleNativeRoute(request({ intentId }, "https://foreign.invalid"), "cancel")).status).toBe(403);
    mocks.impersonating = true;
    expect((await appleNativeRoute(request({ intentId }), "cancel")).status).toBe(403);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
});
