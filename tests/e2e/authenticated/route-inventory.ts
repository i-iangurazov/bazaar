import {
  authenticatedE2EAccounts,
  authenticatedE2EIds,
  type AuthenticatedE2EBaseRole,
} from "./contract";

export const authenticatedBaseRoles = ["ADMIN", "MANAGER", "STAFF", "CASHIER"] as const;

export type AuthenticatedRouteOwnerRequirement = "organization" | "platform";

export type AuthenticatedRouteLocation = {
  pathname: string;
  search?: string;
  hash?: string;
};

export type AuthenticatedRouteDefinition = {
  /** Stable test/report identifier. */
  id: string;
  /** Authoritative route pattern. Dynamic parameters retain the `{id}` notation. */
  pattern: string;
  /** Concrete URL backed by the deterministic authenticated fixture. */
  path: string;
  allowedRoles: readonly AuthenticatedE2EBaseRole[];
  expectedFinal?: AuthenticatedRouteLocation;
  ownerRequirement?: AuthenticatedRouteOwnerRequirement;
  productionOnlyNotFound?: boolean;
};

export type AuthenticatedDynamicRoute = {
  id: string;
  pattern: string;
  allowedRoles: readonly AuthenticatedE2EBaseRole[];
  validPath: string;
  foreignPath: string;
  malformedPath: string;
  missingPath: string;
};

const ALL_ROLES = authenticatedBaseRoles;
const ADMIN_MANAGER = ["ADMIN", "MANAGER"] as const;
const ADMIN_MANAGER_CASHIER = ["ADMIN", "MANAGER", "CASHIER"] as const;
const ADMIN_ONLY = ["ADMIN"] as const;
const NO_BASE_ROLE = [] as const;

const movementDocumentKey = (referenceId: string) =>
  `STOCK_RECEIVING:STOCK_RECEIVING:${referenceId}`;
const movementDocumentSegment = (referenceId: string) =>
  encodeURIComponent(movementDocumentKey(referenceId));

/**
 * The 75 authoritative authenticated page patterns. Query-state variants are
 * intentionally kept in `authenticatedQueryStateRoutes` so neither category
 * can silently inflate the other's coverage count.
 */
export const canonicalAuthenticatedRoutes = [
  {
    id: "pos",
    pattern: "/pos",
    path: "/pos",
    allowedRoles: ALL_ROLES,
  },
  {
    id: "pos-debts",
    pattern: "/pos/debts",
    path: "/pos/debts",
    allowedRoles: ALL_ROLES,
  },
  {
    id: "pos-history",
    pattern: "/pos/history",
    path: "/pos/history",
    allowedRoles: ALL_ROLES,
  },
  { id: "pos-kkm", pattern: "/pos/kkm", path: "/pos/kkm", allowedRoles: ALL_ROLES },
  {
    id: "pos-receipts",
    pattern: "/pos/receipts",
    path: "/pos/receipts",
    allowedRoles: ALL_ROLES,
  },
  {
    id: "pos-registers",
    pattern: "/pos/registers",
    path: "/pos/registers",
    allowedRoles: ALL_ROLES,
  },
  {
    id: "pos-sell",
    pattern: "/pos/sell",
    path: "/pos/sell",
    allowedRoles: ALL_ROLES,
  },
  {
    id: "pos-shifts",
    pattern: "/pos/shifts",
    path: "/pos/shifts",
    allowedRoles: ALL_ROLES,
  },
  {
    id: "cash-compatibility",
    pattern: "/cash",
    path: "/cash",
    allowedRoles: ALL_ROLES,
    expectedFinal: {
      pathname: "/pos/shifts",
      hash: "#cash-movement",
    },
  },
  {
    id: "finance-income-compatibility",
    pattern: "/finance/income",
    path: "/finance/income",
    allowedRoles: ALL_ROLES,
    expectedFinal: {
      pathname: "/pos/shifts",
      search: "?cashMovementType=PAY_IN",
      hash: "#cash-movement",
    },
  },
  {
    id: "finance-expense-compatibility",
    pattern: "/finance/expense",
    path: "/finance/expense",
    allowedRoles: ALL_ROLES,
    expectedFinal: {
      pathname: "/pos/shifts",
      search: "?cashMovementType=PAY_OUT",
      hash: "#cash-movement",
    },
  },
  {
    id: "orders-compatibility",
    pattern: "/orders",
    path: "/orders",
    allowedRoles: ALL_ROLES,
    expectedFinal: { pathname: "/sales/orders" },
  },
  {
    id: "sales-orders",
    pattern: "/sales/orders",
    path: "/sales/orders",
    allowedRoles: ALL_ROLES,
  },
  {
    id: "sales-orders-new",
    pattern: "/sales/orders/new",
    path: "/sales/orders/new",
    allowedRoles: ALL_ROLES,
  },
  {
    id: "sales-orders-metrics",
    pattern: "/sales/orders/metrics",
    path: "/sales/orders/metrics",
    allowedRoles: ALL_ROLES,
  },
  {
    id: "sales-order-detail",
    pattern: "/sales/orders/{id}",
    path: `/sales/orders/${authenticatedE2EIds.primaryOrder}`,
    allowedRoles: ALL_ROLES,
  },
  {
    id: "settings-profile",
    pattern: "/settings/profile",
    path: "/settings/profile",
    allowedRoles: ALL_ROLES,
  },
  {
    id: "help-compliance",
    pattern: "/help/compliance",
    path: "/help/compliance",
    allowedRoles: ALL_ROLES,
  },

  {
    id: "products",
    pattern: "/products",
    path: "/products",
    allowedRoles: ADMIN_MANAGER_CASHIER,
  },
  {
    id: "product-detail",
    pattern: "/products/{id}",
    path: `/products/${authenticatedE2EIds.primaryProduct}`,
    allowedRoles: ADMIN_MANAGER_CASHIER,
  },
  {
    id: "settings-printing",
    pattern: "/settings/printing",
    path: "/settings/printing",
    allowedRoles: ADMIN_MANAGER_CASHIER,
  },
  {
    id: "products-new",
    pattern: "/products/new",
    path: "/products/new",
    allowedRoles: ADMIN_MANAGER,
  },

  {
    id: "dashboard",
    pattern: "/dashboard",
    path: "/dashboard",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "customers",
    pattern: "/customers",
    path: "/customers",
    allowedRoles: ADMIN_MANAGER,
    expectedFinal: {
      pathname: "/customers",
      search: `?storeId=${authenticatedE2EIds.primaryStore}`,
    },
  },
  {
    id: "customers-new-compatibility",
    pattern: "/customers/new",
    path: "/customers/new",
    allowedRoles: ADMIN_MANAGER,
    expectedFinal: {
      pathname: "/customers",
      search: `?add=1&storeId=${authenticatedE2EIds.primaryStore}`,
    },
  },
  {
    id: "inventory",
    pattern: "/inventory",
    path: "/inventory",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "inventory-counts",
    pattern: "/inventory/counts",
    path: "/inventory/counts",
    allowedRoles: ADMIN_MANAGER,
    expectedFinal: {
      pathname: "/inventory/counts",
      search: `?page=1&pageSize=25&storeId=${authenticatedE2EIds.primaryStore}`,
    },
  },
  {
    id: "inventory-counts-new-compatibility",
    pattern: "/inventory/counts/new",
    path: "/inventory/counts/new",
    allowedRoles: ADMIN_MANAGER,
    expectedFinal: {
      pathname: "/inventory/counts",
      search: `?page=1&pageSize=25&storeId=${authenticatedE2EIds.primaryStore}`,
    },
  },
  {
    id: "inventory-count-detail",
    pattern: "/inventory/counts/{id}",
    path: `/inventory/counts/${authenticatedE2EIds.primaryStockCount}`,
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "inventory-movements",
    pattern: "/inventory/movements",
    path: "/inventory/movements",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "inventory-movement-detail",
    pattern: "/inventory/movements/{id}",
    path: `/inventory/movements/${movementDocumentSegment(authenticatedE2EIds.receivingReference)}`,
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "inventory-movement-print",
    pattern: "/inventory/movements/{id}/print",
    path: `/inventory/movements/${movementDocumentSegment(
      authenticatedE2EIds.receivingReference,
    )}/print`,
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "inventory-receiving",
    pattern: "/inventory/receiving",
    path: "/inventory/receiving",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "inventory-receiving-edit",
    pattern: "/inventory/receiving/{id}/edit",
    path: `/inventory/receiving/${authenticatedE2EIds.receivingReference}/edit`,
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "inventory-transfers",
    pattern: "/inventory/transfers",
    path: "/inventory/transfers",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "inventory-transfer-edit",
    pattern: "/inventory/transfers/{id}/edit",
    path: `/inventory/transfers/${authenticatedE2EIds.transferReference}/edit`,
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "inventory-write-offs",
    pattern: "/inventory/write-offs",
    path: "/inventory/write-offs",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "inventory-write-off-edit",
    pattern: "/inventory/write-offs/{id}/edit",
    path: `/inventory/write-offs/${authenticatedE2EIds.writeOffReference}/edit`,
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "purchase-orders",
    pattern: "/purchase-orders",
    path: "/purchase-orders",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "purchase-orders-new",
    pattern: "/purchase-orders/new",
    path: "/purchase-orders/new",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "purchase-order-detail",
    pattern: "/purchase-orders/{id}",
    path: `/purchase-orders/${authenticatedE2EIds.primaryPurchaseOrder}`,
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "suppliers",
    pattern: "/suppliers",
    path: "/suppliers",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "suppliers-new-compatibility",
    pattern: "/suppliers/new",
    path: "/suppliers/new",
    allowedRoles: ADMIN_MANAGER,
    expectedFinal: { pathname: "/suppliers" },
  },
  { id: "stores", pattern: "/stores", path: "/stores", allowedRoles: ADMIN_MANAGER },
  {
    id: "stores-new-compatibility",
    pattern: "/stores/new",
    path: "/stores/new",
    allowedRoles: ADMIN_MANAGER,
    expectedFinal: { pathname: "/stores" },
  },
  {
    id: "store-compliance",
    pattern: "/stores/{id}/compliance",
    path: `/stores/${authenticatedE2EIds.primaryStore}/compliance`,
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "store-hardware",
    pattern: "/stores/{id}/hardware",
    path: `/stores/${authenticatedE2EIds.primaryStore}/hardware`,
    allowedRoles: ADMIN_MANAGER,
  },
  { id: "reports", pattern: "/reports", path: "/reports", allowedRoles: ADMIN_MANAGER },
  {
    id: "reports-analytics",
    pattern: "/reports/analytics",
    path: "/reports/analytics",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "reports-close",
    pattern: "/reports/close",
    path: "/reports/close",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "reports-exports",
    pattern: "/reports/exports",
    path: "/reports/exports",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "reports-receipts",
    pattern: "/reports/receipts",
    path: "/reports/receipts",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "integrations",
    pattern: "/operations/integrations",
    path: "/operations/integrations",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "integration-bakai-store",
    pattern: "/operations/integrations/bakai-store",
    path: "/operations/integrations/bakai-store",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "integration-bazaar-api",
    pattern: "/operations/integrations/bazaar-api",
    path: "/operations/integrations/bazaar-api",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "integration-bazaar-catalog",
    pattern: "/operations/integrations/bazaar-catalog",
    path: "/operations/integrations/bazaar-catalog",
    allowedRoles: ADMIN_MANAGER,
    expectedFinal: {
      pathname: "/operations/integrations/bazaar-catalog",
      search: `?storeId=${authenticatedE2EIds.primaryStore}`,
    },
  },
  {
    id: "integration-email-marketing",
    pattern: "/operations/integrations/email-marketing",
    path: "/operations/integrations/email-marketing",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "integration-m-market",
    pattern: "/operations/integrations/m-market",
    path: "/operations/integrations/m-market",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "integration-o-market",
    pattern: "/operations/integrations/o-market",
    path: "/operations/integrations/o-market",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "integration-product-image-studio",
    pattern: "/operations/integrations/product-image-studio",
    path: "/operations/integrations/product-image-studio",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "settings-attributes",
    pattern: "/settings/attributes",
    path: "/settings/attributes",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "settings-categories",
    pattern: "/settings/categories",
    path: "/settings/categories",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "settings-import",
    pattern: "/settings/import",
    path: "/settings/import",
    allowedRoles: ADMIN_MANAGER,
    expectedFinal: { pathname: "/settings/import", search: "?page=1&pageSize=25" },
  },
  {
    id: "settings-units",
    pattern: "/settings/units",
    path: "/settings/units",
    allowedRoles: ADMIN_MANAGER,
  },

  { id: "admin-jobs", pattern: "/admin/jobs", path: "/admin/jobs", allowedRoles: ADMIN_ONLY },
  {
    id: "admin-metrics",
    pattern: "/admin/metrics",
    path: "/admin/metrics",
    allowedRoles: ADMIN_ONLY,
  },
  {
    id: "admin-support",
    pattern: "/admin/support",
    path: "/admin/support",
    allowedRoles: ADMIN_ONLY,
  },
  { id: "billing", pattern: "/billing", path: "/billing", allowedRoles: ADMIN_ONLY },
  { id: "onboarding", pattern: "/onboarding", path: "/onboarding", allowedRoles: ADMIN_ONLY },
  {
    id: "settings-store-groups",
    pattern: "/settings/store-groups",
    path: "/settings/store-groups",
    allowedRoles: ADMIN_ONLY,
  },
  {
    id: "settings-users",
    pattern: "/settings/users",
    path: "/settings/users",
    allowedRoles: ADMIN_ONLY,
  },
  {
    id: "settings-whats-new",
    pattern: "/settings/whats-new",
    path: "/settings/whats-new",
    allowedRoles: ADMIN_ONLY,
  },

  {
    id: "dev-scanner-test",
    pattern: "/dev/scanner-test",
    path: "/dev/scanner-test",
    allowedRoles: ADMIN_ONLY,
    productionOnlyNotFound: true,
  },
  {
    id: "platform",
    pattern: "/platform",
    path: "/platform",
    allowedRoles: NO_BASE_ROLE,
    ownerRequirement: "platform",
  },
  {
    id: "settings-diagnostics",
    pattern: "/settings/diagnostics",
    path: "/settings/diagnostics",
    allowedRoles: NO_BASE_ROLE,
    ownerRequirement: "organization",
  },
] as const satisfies readonly AuthenticatedRouteDefinition[];

/** The six explicitly supplied query-state URL forms. */
export const authenticatedQueryStateRoutes = [
  {
    id: "products-new-product",
    pattern: "/products/new?type=product",
    path: "/products/new?type=product",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "products-new-bundle",
    pattern: "/products/new?type=bundle",
    path: "/products/new?type=bundle",
    allowedRoles: ADMIN_MANAGER,
  },
  {
    id: "customers-add",
    pattern: "/customers?add=1",
    path: "/customers?add=1",
    allowedRoles: ADMIN_MANAGER,
    expectedFinal: {
      pathname: "/customers",
      search: `?add=1&storeId=${authenticatedE2EIds.primaryStore}`,
    },
  },
  {
    id: "inventory-receive-action",
    pattern: "/inventory?action=receive",
    path: "/inventory?action=receive",
    allowedRoles: ADMIN_MANAGER,
    expectedFinal: { pathname: "/inventory/receiving" },
  },
  {
    id: "inventory-adjust-action",
    pattern: "/inventory?action=adjust",
    path: "/inventory?action=adjust",
    allowedRoles: ADMIN_MANAGER,
    expectedFinal: { pathname: "/inventory" },
  },
  {
    id: "inventory-transfer-action",
    pattern: "/inventory?action=transfer",
    path: "/inventory?action=transfer",
    allowedRoles: ADMIN_MANAGER,
    expectedFinal: {
      pathname: "/inventory/transfers",
      search: `?fromStoreId=${authenticatedE2EIds.primaryStore}`,
    },
  },
] as const satisfies readonly AuthenticatedRouteDefinition[];

/** All 81 authenticated URL forms used by the role and responsive matrices. */
export const authenticatedRouteForms: readonly AuthenticatedRouteDefinition[] = [
  ...canonicalAuthenticatedRoutes,
  ...authenticatedQueryStateRoutes,
];

const missingDynamicId = "czzzzzzzzzzzzzzzzzzzzzzzz";
const malformedDynamicId = "bad!id";

/**
 * The 11 dynamic route patterns, each with deterministic owned, cross-tenant,
 * malformed, and syntactically-valid-but-missing record cases.
 */
export const authenticatedDynamicRoutes = [
  {
    id: "sales-order",
    pattern: "/sales/orders/{id}",
    allowedRoles: ALL_ROLES,
    validPath: `/sales/orders/${authenticatedE2EIds.primaryOrder}`,
    foreignPath: `/sales/orders/${authenticatedE2EIds.secondTenantOrder}`,
    malformedPath: `/sales/orders/${malformedDynamicId}`,
    missingPath: `/sales/orders/${missingDynamicId}`,
  },
  {
    id: "product",
    pattern: "/products/{id}",
    allowedRoles: ADMIN_MANAGER_CASHIER,
    validPath: `/products/${authenticatedE2EIds.primaryProduct}`,
    foreignPath: `/products/${authenticatedE2EIds.secondTenantProduct}`,
    malformedPath: `/products/${malformedDynamicId}`,
    missingPath: `/products/${missingDynamicId}`,
  },
  {
    id: "inventory-count",
    pattern: "/inventory/counts/{id}",
    allowedRoles: ADMIN_MANAGER,
    validPath: `/inventory/counts/${authenticatedE2EIds.primaryStockCount}`,
    foreignPath: `/inventory/counts/${authenticatedE2EIds.secondTenantStockCount}`,
    malformedPath: `/inventory/counts/${malformedDynamicId}`,
    missingPath: `/inventory/counts/${missingDynamicId}`,
  },
  {
    id: "inventory-movement",
    pattern: "/inventory/movements/{id}",
    allowedRoles: ADMIN_MANAGER,
    validPath: `/inventory/movements/${movementDocumentSegment(
      authenticatedE2EIds.receivingReference,
    )}`,
    foreignPath: `/inventory/movements/${movementDocumentSegment(
      authenticatedE2EIds.foreignReceivingReference,
    )}`,
    malformedPath: `/inventory/movements/${malformedDynamicId}`,
    missingPath: `/inventory/movements/${missingDynamicId}`,
  },
  {
    id: "inventory-movement-print",
    pattern: "/inventory/movements/{id}/print",
    allowedRoles: ADMIN_MANAGER,
    validPath: `/inventory/movements/${movementDocumentSegment(
      authenticatedE2EIds.receivingReference,
    )}/print`,
    foreignPath: `/inventory/movements/${movementDocumentSegment(
      authenticatedE2EIds.foreignReceivingReference,
    )}/print`,
    malformedPath: `/inventory/movements/${malformedDynamicId}/print`,
    missingPath: `/inventory/movements/${missingDynamicId}/print`,
  },
  {
    id: "inventory-receiving-edit",
    pattern: "/inventory/receiving/{id}/edit",
    allowedRoles: ADMIN_MANAGER,
    validPath: `/inventory/receiving/${authenticatedE2EIds.receivingReference}/edit`,
    foreignPath: `/inventory/receiving/${authenticatedE2EIds.foreignReceivingReference}/edit`,
    malformedPath: `/inventory/receiving/${malformedDynamicId}/edit`,
    missingPath: `/inventory/receiving/${missingDynamicId}/edit`,
  },
  {
    id: "inventory-transfer-edit",
    pattern: "/inventory/transfers/{id}/edit",
    allowedRoles: ADMIN_MANAGER,
    validPath: `/inventory/transfers/${authenticatedE2EIds.transferReference}/edit`,
    foreignPath: `/inventory/transfers/${authenticatedE2EIds.foreignTransferReference}/edit`,
    malformedPath: `/inventory/transfers/${malformedDynamicId}/edit`,
    missingPath: `/inventory/transfers/${missingDynamicId}/edit`,
  },
  {
    id: "inventory-write-off-edit",
    pattern: "/inventory/write-offs/{id}/edit",
    allowedRoles: ADMIN_MANAGER,
    validPath: `/inventory/write-offs/${authenticatedE2EIds.writeOffReference}/edit`,
    foreignPath: `/inventory/write-offs/${authenticatedE2EIds.foreignWriteOffReference}/edit`,
    malformedPath: `/inventory/write-offs/${malformedDynamicId}/edit`,
    missingPath: `/inventory/write-offs/${missingDynamicId}/edit`,
  },
  {
    id: "purchase-order",
    pattern: "/purchase-orders/{id}",
    allowedRoles: ADMIN_MANAGER,
    validPath: `/purchase-orders/${authenticatedE2EIds.primaryPurchaseOrder}`,
    foreignPath: `/purchase-orders/${authenticatedE2EIds.secondTenantPurchaseOrder}`,
    malformedPath: `/purchase-orders/${malformedDynamicId}`,
    missingPath: `/purchase-orders/${missingDynamicId}`,
  },
  {
    id: "store-compliance",
    pattern: "/stores/{id}/compliance",
    allowedRoles: ADMIN_MANAGER,
    validPath: `/stores/${authenticatedE2EIds.primaryStore}/compliance`,
    foreignPath: `/stores/${authenticatedE2EIds.secondTenantStore}/compliance`,
    malformedPath: `/stores/${malformedDynamicId}/compliance`,
    missingPath: `/stores/${missingDynamicId}/compliance`,
  },
  {
    id: "store-hardware",
    pattern: "/stores/{id}/hardware",
    allowedRoles: ADMIN_MANAGER,
    validPath: `/stores/${authenticatedE2EIds.primaryStore}/hardware`,
    foreignPath: `/stores/${authenticatedE2EIds.secondTenantStore}/hardware`,
    malformedPath: `/stores/${malformedDynamicId}/hardware`,
    missingPath: `/stores/${missingDynamicId}/hardware`,
  },
] as const satisfies readonly AuthenticatedDynamicRoute[];

/** Backward-compatible descriptive alias for source-contract tests. */
export const authenticatedDynamicRouteCases = authenticatedDynamicRoutes;

export const authenticatedRoleHomePaths = {
  ADMIN: authenticatedE2EAccounts.admin.homePath,
  MANAGER: authenticatedE2EAccounts.manager.homePath,
  STAFF: authenticatedE2EAccounts.staff.homePath,
  CASHIER: authenticatedE2EAccounts.cashier.homePath,
} as const satisfies Record<AuthenticatedE2EBaseRole, "/dashboard" | "/pos">;

export const expectedLocationForAuthenticatedRoute = (
  route: AuthenticatedRouteDefinition,
): AuthenticatedRouteLocation => {
  if (route.expectedFinal) {
    return route.expectedFinal;
  }
  const url = new URL(route.path, "http://127.0.0.1");
  return {
    pathname: url.pathname,
    ...(url.search ? { search: url.search } : {}),
    ...(url.hash ? { hash: url.hash } : {}),
  };
};

/** Middleware denial contract: role home plus the original path/query in `from`. */
export const expectedDeniedLocation = (
  role: AuthenticatedE2EBaseRole,
  requestedPath: string,
): AuthenticatedRouteLocation => {
  const requested = new URL(requestedPath, "http://127.0.0.1");
  return {
    pathname: authenticatedRoleHomePaths[role],
    search: `?${new URLSearchParams({ from: `${requested.pathname}${requested.search}` })}`,
  };
};
