import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ card: vi.fn(), qr: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "synthetic-session" }) }) }));
vi.mock("@/server/services/loyalty/memberAuth", () => ({
  LOYALTY_SESSION_COOKIE: "loyalty_session", getCardView: state.card, issueCardToken: state.qr,
}));
vi.mock("@/server/services/loyalty/qr", () => ({ renderQrDataUrl: async () => "data:image/png;base64,AAAA" }));
import { GET } from "@/app/api/loyalty/card/route";
import { POST } from "@/app/api/loyalty/card/qr/route";
import { AppError } from "@/server/services/errors";

beforeEach(() => vi.clearAllMocks());
describe("loyalty card transport errors", () => {
  it.each([["card", GET], ["qr", POST]] as const)("does not turn a %s database failure into a false expired session or disclose internals", async (name, request) => {
    state[name].mockRejectedValue(new Error("private-database-detail"));
    const result = await request();
    expect(result.status).toBe(500);
    expect(await result.json()).toEqual({ message: "genericMessage" });
  });
  it.each([["card", GET], ["qr", POST]] as const)("keeps the %s session rejection authoritative", async (name, request) => {
    state[name].mockRejectedValue(new AppError("loyaltyUnauthorized", "UNAUTHORIZED", 401));
    const result = await request();
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ message: "loyaltyUnauthorized" });
  });
});
