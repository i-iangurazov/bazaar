import { afterEach, describe, expect, it, vi } from "vitest";
import { clientRequestHeaders } from "@/lib/clientRequestHeaders";
import { ensureRequestId } from "@/server/middleware/requestContext";
afterEach(() => vi.unstubAllGlobals());
describe("request tracing on local HTTP browsers", () => {
  it("allows requests without randomUUID and lets the server generate distinct trace IDs", () => {
    vi.stubGlobal("crypto", { getRandomValues: vi.fn() });
    const headers = clientRequestHeaders();
    expect(headers).toEqual({});
    const first = ensureRequestId(headers["x-request-id"]);
    const second = ensureRequestId(clientRequestHeaders()["x-request-id"]);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });
  it("preserves browser trace IDs when the secure-context API exists", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    vi.stubGlobal("crypto", { randomUUID: () => id });
    expect(ensureRequestId(clientRequestHeaders()["x-request-id"])).toBe(id);
  });
  it("allows rendering without a browser crypto object", () => {
    vi.stubGlobal("crypto", undefined);
    expect(clientRequestHeaders()).toEqual({});
  });
});
