import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetToken } = vi.hoisted(() => ({
  mockGetToken: vi.fn(),
}));

vi.mock("next-auth/jwt", () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
}));

import { isProtectedPath, middleware, protectedPrefixes } from "../../middleware";

const requestFor = (path: string) => new NextRequest(`https://bazaar.test${path}`);

describe("middleware route protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetToken.mockResolvedValue(null);
  });

  it.each(protectedPrefixes)("redirects unauthenticated private route %s", async (prefix) => {
    const privatePath = `${prefix}/probe`;
    const response = await middleware(requestFor(`${privatePath}?view=1`));
    const location = new URL(response.headers.get("location") ?? "");

    expect(isProtectedPath(privatePath)).toBe(true);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(`${privatePath}?view=1`);
    expect(mockGetToken).toHaveBeenCalledTimes(1);
  });

  it.each([
    "/",
    "/login",
    "/signup",
    "/invite/token",
    "/verify",
    "/reset",
    "/register-business",
    "/c/public-store",
  ])("keeps public route public: %s", async (path) => {
    const response = await middleware(requestFor(path));

    expect(isProtectedPath(path)).toBe(false);
    expect(response.headers.get("location")).toBeNull();
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it.each([
    {
      role: "CASHIER",
      path: "/products",
      expectedPath: "/pos",
      expectedFrom: "/products",
    },
    {
      role: "MANAGER",
      path: "/settings/users?create=1",
      expectedPath: "/dashboard",
      expectedFrom: "/settings/users?create=1",
    },
    {
      role: "MANAGER",
      path: "/admin/support",
      expectedPath: "/dashboard",
      expectedFrom: "/admin/support",
    },
    {
      role: "MANAGER",
      path: "/billing",
      expectedPath: "/dashboard",
      expectedFrom: "/billing",
    },
    {
      role: "ADMIN",
      path: "/platform",
      expectedPath: "/dashboard",
      expectedFrom: "/platform",
    },
  ])("redirects denied $role access to $path", async ({ role, path, expectedPath, expectedFrom }) => {
    mockGetToken.mockResolvedValue({
      sub: "user-1",
      role,
      organizationId: "org-1",
      isPlatformOwner: false,
      isOrgOwner: false,
    });

    const response = await middleware(requestFor(path));
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.pathname).toBe(expectedPath);
    expect(location.searchParams.get("from")).toBe(expectedFrom);
  });

  it.each([
    { role: "CASHIER", path: "/pos" },
    { role: "MANAGER", path: "/products" },
    { role: "ADMIN", path: "/dashboard" },
    { role: "ADMIN", path: "/platform", isPlatformOwner: true },
  ])("allows permitted $role access to $path", async ({ role, path, isPlatformOwner = false }) => {
    mockGetToken.mockResolvedValue({
      sub: "user-1",
      role,
      organizationId: "org-1",
      isPlatformOwner,
      isOrgOwner: false,
    });

    const response = await middleware(requestFor(path));

    expect(response.headers.get("location")).toBeNull();
  });
});
