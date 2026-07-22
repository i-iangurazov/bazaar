import { describe, expect, it } from "vitest";

import { canAccessAppRoute, hasPermission } from "@/lib/roleAccess";

describe("B0 Agent 4 route-access P0 verification", () => {
  it.each(["/settings/store-groups", "/settings/categories"])(
    "A4-011: allows a cashier to pass the route guard for %s",
    (pathname) => {
      const cashier = { role: "CASHIER" };

      expect(hasPermission(cashier, "manageSettings")).toBe(false);
      expect(hasPermission(cashier, "manageProducts")).toBe(false);
      expect(canAccessAppRoute(pathname, cashier)).toBe(true);
    },
  );
});
