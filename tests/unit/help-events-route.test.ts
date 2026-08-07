import { beforeEach, describe, expect, it, vi } from "vitest";

const info = vi.fn();
vi.mock("@/server/logging", () => ({ getLogger: () => ({ info }) }));

describe("Bazaar Guide analytics endpoint", () => {
  beforeEach(() => info.mockClear());

  it("accepts anonymous low-data feedback and strips query strings from the source route", async () => {
    const { POST } = await import("@/app/api/help/events/route");
    const response = await POST(
      new Request("http://localhost/api/help/events", {
        method: "POST",
        body: JSON.stringify({
          type: "feedback",
          guideId: "pos/make-sale",
          helpful: true,
          sourceRoute: "/pos/sell?customer=private",
        }),
      }),
    );
    expect(response.status).toBe(204);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "feedback",
        guideId: "pos/make-sale",
        helpful: true,
        sourceRoute: "/pos/sell",
      }),
      "bazaar guide event",
    );
  });

  it("redacts email and phone patterns from search telemetry", async () => {
    const { POST } = await import("@/app/api/help/events/route");
    const response = await POST(
      new Request("http://localhost/api/help/events", {
        method: "POST",
        body: JSON.stringify({
          type: "zero_result",
          query: "help me@example.com +996 555 123 456",
        }),
      }),
    );
    expect(response.status).toBe(204);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ query: "help [email] [number]" }),
      "bazaar guide event",
    );
  });

  it("rejects unknown events and malformed guide identifiers", async () => {
    const { POST } = await import("@/app/api/help/events/route");
    expect(
      (
        await POST(
          new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ type: "unknown" }),
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ type: "guide_view", guideId: "../secret" }),
          }),
        )
      ).status,
    ).toBe(400);
    expect(info).not.toHaveBeenCalled();
  });
});
