import { describe, expect, it } from "vitest";

import {
  canAccessAppRoute,
  getRoleHomePath,
  hasPermission,
  permissionForSearchResultType,
  type AppPermission,
  type RoleAccess,
} from "@/lib/roleAccess";

const permissions: AppPermission[] = [
  "viewDashboard",
  "usePos",
  "viewSales",
  "viewCash",
  "viewProducts",
  "manageProducts",
  "viewInventory",
  "viewPurchaseOrders",
  "viewSuppliers",
  "viewStores",
  "viewReports",
  "manageIntegrations",
  "manageImports",
  "manageSettings",
  "manageUsers",
  "manageBilling",
  "viewSystem",
  "viewSupport",
  "viewPlatform",
  "viewDiagnostics",
  "viewHelp",
  "viewProfile",
];

const allowed = (access: RoleAccess) =>
  permissions.filter((permission) => hasPermission(access, permission));

describe("role access model", () => {
  it("keeps admin access close to the previous full business navigation", () => {
    const adminAccess = allowed({ role: "ADMIN", isPlatformOwner: true, isOrgOwner: true });

    expect(adminAccess).toEqual(expect.arrayContaining(permissions));
  });

  it("lets managers see operational areas without sensitive admin/platform tools", () => {
    const managerAccess = allowed({ role: "MANAGER" });

    expect(managerAccess).toEqual(
      expect.arrayContaining([
        "viewDashboard",
        "usePos",
        "viewSales",
        "viewCash",
        "viewProducts",
        "manageProducts",
        "viewInventory",
        "viewPurchaseOrders",
        "viewSuppliers",
        "viewStores",
        "viewReports",
        "manageIntegrations",
        "viewHelp",
        "viewProfile",
      ]),
    );
    expect(managerAccess).not.toEqual(
      expect.arrayContaining([
        "manageUsers",
        "manageBilling",
        "viewSupport",
        "viewPlatform",
        "viewSystem",
      ]),
    );
  });

  it.each(["CASHIER", "STAFF"])(
    "filters %s down to POS, sales, cash, help, and profile access",
    (role) => {
      const access = allowed({ role });

      expect(access).toEqual(["usePos", "viewSales", "viewCash", "viewHelp", "viewProfile"]);
    },
  );

  it("redirects denied app routes to the role home path", () => {
    expect(canAccessAppRoute("/products", { role: "CASHIER" })).toBe(false);
    expect(canAccessAppRoute("/pos", { role: "CASHIER" })).toBe(true);
    expect(canAccessAppRoute("/settings/users", { role: "MANAGER" })).toBe(false);
    expect(canAccessAppRoute("/platform", { role: "ADMIN" })).toBe(false);
    expect(canAccessAppRoute("/platform", { role: "ADMIN", isPlatformOwner: true })).toBe(true);
    expect(getRoleHomePath({ role: "CASHIER" })).toBe("/pos");
    expect(getRoleHomePath({ role: "ADMIN" })).toBe("/dashboard");
  });

  it("maps command palette result types to navigation permissions", () => {
    expect(permissionForSearchResultType("product")).toBe("viewProducts");
    expect(permissionForSearchResultType("supplier")).toBe("viewSuppliers");
    expect(permissionForSearchResultType("store")).toBe("viewStores");
    expect(permissionForSearchResultType("purchaseOrder")).toBe("viewPurchaseOrders");
  });
});
