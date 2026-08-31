export const authenticatedE2EDatabaseName = "bazaar_hardening_agent4_platform";
export const authenticatedE2ESeedPrefix = "QA-BAZAAR";
export const authenticatedE2EPassword = "QA-BAZAAR-Local-Auth-2026!";
export const authenticatedE2ERedisKeyPrefix = "bazaar:test:authenticated-e2e:";

export const authenticatedE2EAccountKeys = [
  "admin",
  "manager",
  "staff",
  "cashier",
  "organizationOwner",
  "platformOwner",
  "secondTenantAdmin",
] as const;

export type AuthenticatedE2EAccountKey = (typeof authenticatedE2EAccountKeys)[number];
export type AuthenticatedE2EBaseRole = "ADMIN" | "MANAGER" | "STAFF" | "CASHIER";

type AuthenticatedE2EAccount = {
  email: string;
  name: string;
  role: AuthenticatedE2EBaseRole;
  homePath: "/dashboard" | "/pos";
  isOrgOwner?: boolean;
  isPlatformOwner?: boolean;
  secondTenant?: boolean;
};

export const authenticatedE2EAccounts = {
  admin: {
    email: "qa-bazaar-admin@auth-e2e.test",
    name: "QA-BAZAAR Admin",
    role: "ADMIN",
    homePath: "/dashboard",
  },
  manager: {
    email: "qa-bazaar-manager@auth-e2e.test",
    name: "QA-BAZAAR Manager",
    role: "MANAGER",
    homePath: "/dashboard",
  },
  staff: {
    email: "qa-bazaar-staff@auth-e2e.test",
    name: "QA-BAZAAR Staff",
    role: "STAFF",
    homePath: "/pos",
  },
  cashier: {
    email: "qa-bazaar-cashier@auth-e2e.test",
    name: "QA-BAZAAR Cashier",
    role: "CASHIER",
    homePath: "/pos",
  },
  organizationOwner: {
    email: "qa-bazaar-organization-owner@auth-e2e.test",
    name: "QA-BAZAAR Organization Owner",
    role: "ADMIN",
    homePath: "/dashboard",
    isOrgOwner: true,
  },
  platformOwner: {
    email: "qa-bazaar-platform-owner@auth-e2e.test",
    name: "QA-BAZAAR Platform Owner",
    role: "ADMIN",
    homePath: "/dashboard",
    isOrgOwner: true,
    isPlatformOwner: true,
  },
  secondTenantAdmin: {
    email: "qa-bazaar-second-tenant-admin@auth-e2e.test",
    name: "QA-BAZAAR Second Tenant Admin",
    role: "ADMIN",
    homePath: "/dashboard",
    secondTenant: true,
  },
} as const satisfies Record<AuthenticatedE2EAccountKey, AuthenticatedE2EAccount>;

export const authenticatedE2EStorageStatePath = (key: AuthenticatedE2EAccountKey) =>
  `test-results/authenticated/.auth/${key}.json`;

export const authenticatedE2EIds = {
  primaryOrganization: "qa_bazaar_auth_org_primary",
  secondOrganization: "qa_bazaar_auth_org_second",
  primaryStore: "qa_bazaar_auth_store_primary",
  secondaryStore: "qa_bazaar_auth_store_secondary",
  secondTenantStore: "qa_bazaar_auth_store_foreign",
  secondTenantSecondaryStore: "qa_bazaar_auth_store_foreign_secondary",
  primaryUnit: "qa_bazaar_auth_unit_primary",
  secondTenantUnit: "qa_bazaar_auth_unit_foreign",
  primarySupplier: "qa_bazaar_auth_supplier_primary",
  secondTenantSupplier: "qa_bazaar_auth_supplier_foreign",
  primaryProduct: "qa_bazaar_auth_product_primary",
  secondTenantProduct: "qa_bazaar_auth_product_foreign",
  primaryCustomer: "qa_bazaar_auth_customer_primary",
  primaryOrder: "qa_bazaar_auth_order_primary",
  secondTenantOrder: "qa_bazaar_auth_order_foreign",
  primaryOrderLine: "qa_bazaar_auth_order_line_primary",
  secondTenantOrderLine: "qa_bazaar_auth_order_line_foreign",
  primaryPurchaseOrder: "qa_bazaar_auth_purchase_order_primary",
  secondTenantPurchaseOrder: "qa_bazaar_auth_purchase_order_foreign",
  primaryPurchaseOrderLine: "qa_bazaar_auth_purchase_order_line_primary",
  secondTenantPurchaseOrderLine: "qa_bazaar_auth_purchase_order_line_foreign",
  primaryStockCount: "qa_bazaar_auth_stock_count_primary",
  secondTenantStockCount: "qa_bazaar_auth_stock_count_foreign",
  primaryStockCountLine: "qa_bazaar_auth_stock_count_line_primary",
  secondTenantStockCountLine: "qa_bazaar_auth_stock_count_line_foreign",
  primaryRegister: "qa_bazaar_auth_register_primary",
  secondaryRegister: "qa_bazaar_auth_register_secondary",
  primaryShift: "qa_bazaar_auth_shift_primary",
  receivingReference: "qa_bazaar_auth_receiving_primary",
  transferReference: "qa_bazaar_auth_transfer_primary",
  writeOffReference: "qa_bazaar_auth_write_off_primary",
  foreignReceivingReference: "qa_bazaar_auth_receiving_foreign",
  foreignTransferReference: "qa_bazaar_auth_transfer_foreign",
  foreignWriteOffReference: "qa_bazaar_auth_write_off_foreign",
  receivingMovement: "qa_bazaar_auth_movement_receiving",
  transferOutMovement: "qa_bazaar_auth_movement_transfer_out",
  transferInMovement: "qa_bazaar_auth_movement_transfer_in",
  writeOffMovement: "qa_bazaar_auth_movement_write_off",
  foreignReceivingMovement: "qa_bazaar_auth_movement_receiving_foreign",
  foreignTransferOutMovement: "qa_bazaar_auth_movement_transfer_out_foreign",
  foreignTransferInMovement: "qa_bazaar_auth_movement_transfer_in_foreign",
  foreignWriteOffMovement: "qa_bazaar_auth_movement_write_off_foreign",
} as const;

const localDatabaseHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export const assertAuthenticatedE2EDatabaseUrl = (value: string | undefined) => {
  const configured = value?.trim();
  if (!configured) {
    throw new Error(
      "E2E_AUTH_DATABASE_URL is required and must target the allowlisted local authenticated E2E database.",
    );
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("E2E_AUTH_DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("E2E_AUTH_DATABASE_URL must use the PostgreSQL protocol.");
  }
  if (!localDatabaseHosts.has(url.hostname.toLowerCase())) {
    throw new Error("Authenticated E2E is restricted to a loopback PostgreSQL host.");
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (databaseName !== authenticatedE2EDatabaseName) {
    throw new Error(`Authenticated E2E may only use the ${authenticatedE2EDatabaseName} database.`);
  }
  if (!url.username) {
    throw new Error("E2E_AUTH_DATABASE_URL must include an explicit local database user.");
  }

  return url.toString();
};

export const assertAuthenticatedE2ERedisUrl = (value: string | undefined) => {
  const configured = value?.trim();
  if (!configured) {
    throw new Error(
      "E2E_AUTH_REDIS_URL is required for production-mode authenticated E2E and must target loopback Redis.",
    );
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("E2E_AUTH_REDIS_URL must be a valid Redis URL.");
  }

  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("E2E_AUTH_REDIS_URL must use the Redis protocol.");
  }
  if (!localDatabaseHosts.has(url.hostname.toLowerCase())) {
    throw new Error("Authenticated E2E is restricted to a loopback Redis host.");
  }

  return url.toString();
};

export const assertAuthenticatedE2EBaseUrl = (value: string | undefined) => {
  const configured = value?.trim();
  if (!configured) {
    throw new Error("Authenticated E2E requires a local base URL.");
  }
  const url = new URL(configured);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !localDatabaseHosts.has(url.hostname.toLowerCase())
  ) {
    throw new Error("Authenticated E2E may only target a local HTTP(S) server.");
  }
  return url.origin;
};
