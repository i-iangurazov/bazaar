import { describe, expect, it } from "vitest";

import { canAccessAppRoute, hasPermission } from "@/lib/roleAccess";

describe("B1 Agent 4 route-access security contract", () => {
  it.each(["/settings/store-groups", "/settings/categories"])(
    "A4-011: rejects a cashier at the route guard for %s",
    (pathname) => {
      const cashier = { role: "CASHIER" };

      expect(hasPermission(cashier, "manageSettings")).toBe(false);
      expect(hasPermission(cashier, "manageProducts")).toBe(false);
      expect(canAccessAppRoute(pathname, cashier)).toBe(false);
    },
  );

  it("keeps the authorized settings route matrix intact", () => {
    expect(canAccessAppRoute("/settings/categories", { role: "MANAGER" })).toBe(true);
    expect(canAccessAppRoute("/settings/store-groups", { role: "MANAGER" })).toBe(false);
    expect(canAccessAppRoute("/settings/categories", { role: "ADMIN" })).toBe(true);
    expect(canAccessAppRoute("/settings/store-groups", { role: "ADMIN" })).toBe(true);
  });
});
