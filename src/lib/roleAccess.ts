export type AppRole = "ADMIN" | "MANAGER" | "STAFF" | "CASHIER";

export type RoleAccess = {
  role?: string | null;
  isPlatformOwner?: boolean | null;
  isOrgOwner?: boolean | null;
};

export type AppPermission =
  | "viewDashboard"
  | "usePos"
  | "viewSales"
  | "viewCash"
  | "viewProducts"
  | "manageProducts"
  | "viewInventory"
  | "viewPurchaseOrders"
  | "viewSuppliers"
  | "viewStores"
  | "viewReports"
  | "manageIntegrations"
  | "manageImports"
  | "manageSettings"
  | "manageUsers"
  | "manageBilling"
  | "viewSystem"
  | "viewSupport"
  | "viewPlatform"
  | "viewDiagnostics"
  | "viewHelp"
  | "viewProfile";

const appRoles: AppRole[] = ["ADMIN", "MANAGER", "STAFF", "CASHIER"];

export const normalizeAppRole = (role?: string | null): AppRole =>
  appRoles.includes(role as AppRole) ? (role as AppRole) : "STAFF";

const rolePermissions: Record<AppRole, AppPermission[]> = {
  ADMIN: [
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
    "viewHelp",
    "viewProfile",
  ],
  MANAGER: [
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
  ],
  STAFF: ["usePos", "viewSales", "viewCash", "viewHelp", "viewProfile"],
  CASHIER: ["usePos", "viewSales", "viewCash", "viewHelp", "viewProfile"],
};

export const hasPermission = (access: RoleAccess, permission?: AppPermission) => {
  if (!permission) {
    return true;
  }
  if (permission === "viewPlatform") {
    return Boolean(access.isPlatformOwner);
  }
  if (permission === "viewDiagnostics") {
    return Boolean(access.isOrgOwner);
  }
  return rolePermissions[normalizeAppRole(access.role)].includes(permission);
};

export const canCreateProductForRole = (access: RoleAccess) =>
  hasPermission(access, "manageProducts");

export const getRoleHomePath = (access: RoleAccess) => {
  const role = normalizeAppRole(access.role);
  return role === "CASHIER" || role === "STAFF" ? "/pos" : "/dashboard";
};

const routeAccessRules: Array<{ prefix: string; permission: AppPermission }> = [
  { prefix: "/platform", permission: "viewPlatform" },
  { prefix: "/admin/support", permission: "viewSupport" },
  { prefix: "/admin/jobs", permission: "viewSystem" },
  { prefix: "/admin/metrics", permission: "viewSystem" },
  { prefix: "/billing", permission: "manageBilling" },
  { prefix: "/settings/users", permission: "manageUsers" },
  { prefix: "/settings/import", permission: "manageImports" },
  { prefix: "/settings/attributes", permission: "manageSettings" },
  { prefix: "/settings/units", permission: "manageSettings" },
  { prefix: "/settings/printing", permission: "manageSettings" },
  { prefix: "/settings/whats-new", permission: "manageSettings" },
  { prefix: "/settings/diagnostics", permission: "viewDiagnostics" },
  { prefix: "/operations/integrations", permission: "manageIntegrations" },
  { prefix: "/onboarding", permission: "manageSettings" },
  { prefix: "/dev", permission: "viewSystem" },
  { prefix: "/reports", permission: "viewReports" },
  { prefix: "/purchase-orders", permission: "viewPurchaseOrders" },
  { prefix: "/suppliers", permission: "viewSuppliers" },
  { prefix: "/stores", permission: "viewStores" },
  { prefix: "/inventory", permission: "viewInventory" },
  { prefix: "/products", permission: "viewProducts" },
  { prefix: "/sales/orders", permission: "viewSales" },
  { prefix: "/orders", permission: "viewSales" },
  { prefix: "/customers", permission: "viewSales" },
  { prefix: "/pos", permission: "usePos" },
  { prefix: "/cash", permission: "viewCash" },
  { prefix: "/finance", permission: "viewCash" },
  { prefix: "/dashboard", permission: "viewDashboard" },
  { prefix: "/help", permission: "viewHelp" },
  { prefix: "/settings/profile", permission: "viewProfile" },
];

const matchesPrefix = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export const canAccessAppRoute = (pathname: string, access: RoleAccess) => {
  const rule = routeAccessRules.find((entry) => matchesPrefix(pathname, entry.prefix));
  return rule ? hasPermission(access, rule.permission) : true;
};

export const permissionForSearchResultType = (
  type: "product" | "supplier" | "store" | "purchaseOrder",
): AppPermission => {
  switch (type) {
    case "supplier":
      return "viewSuppliers";
    case "store":
      return "viewStores";
    case "purchaseOrder":
      return "viewPurchaseOrders";
    default:
      return "viewProducts";
  }
};
