import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock("next-auth/jwt", () => ({ getToken: mocks.token }));
import { isProtectedPath, middleware } from "@/middleware";
import { canAccessAppRoute } from "@/lib/roleAccess";

describe("BAAM page routing guards", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.token.mockResolvedValue(null); });
  it("protects the page and descendants and preserves the requested query on anonymous login", async () => {
    expect(isProtectedPath("/baam")).toBe(true);
    expect(isProtectedPath("/baam/detail")).toBe(true);
    expect(isProtectedPath("/baam-other")).toBe(false);
    const response = await middleware(new NextRequest("http://localhost/baam?storeId=chosen"));
    const redirect = new URL(response.headers.get("location")!);
    expect(redirect.pathname).toBe("/login");
    expect(redirect.searchParams.get("next")).toBe("/baam?storeId=chosen");
  });
  it.each(["ADMIN", "MANAGER", "STAFF", "CASHIER"])("matches report navigation access for %s", async role => {
    const allowed = role === "ADMIN" || role === "MANAGER";
    expect(canAccessAppRoute("/baam", { role })).toBe(allowed);
    mocks.token.mockResolvedValue({ role });
    const response = await middleware(new NextRequest("http://localhost/baam"));
    expect(response.headers.get("location") === null).toBe(allowed);
  });
});
