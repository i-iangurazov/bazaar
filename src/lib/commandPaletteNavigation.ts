import { appLinks, appRoutes } from "@/lib/appRoutes";
import { buildPosCashMovementHref } from "@/lib/posCashMovementRoute";
import {
  canAccessAppRoute,
  hasPermission,
  permissionForSearchResultType,
  type AppPermission,
  type RoleAccess,
} from "@/lib/roleAccess";

export type CommandContext = { storeId?: string; fromStoreId?: string };
type CommandDestination = {
  href: (context: CommandContext) => string;
  permission: AppPermission;
};

export const commandDestinations = {
  "create-sale-order": { href: () => appRoutes.sell, permission: "usePos" },
  "sale-return": { href: () => appRoutes.salesHistory, permission: "viewSales" },
  "inventory-receive": { href: () => appRoutes.receiving, permission: "viewInventory" },
  "inventory-adjust": {
    href: ({ storeId }) => appLinks.writeOff(storeId),
    permission: "viewInventory",
  },
  "inventory-count": {
    href: ({ storeId }) => appLinks.newCount(storeId),
    permission: "viewInventory",
  },
  "inventory-transfer": {
    href: ({ fromStoreId, storeId }) => appLinks.transfer(fromStoreId || storeId),
    permission: "viewInventory",
  },
  "create-product": {
    href: ({ storeId }) => appLinks.newProduct("product", storeId),
    permission: "manageProducts",
  },
  "create-bundle": {
    href: ({ storeId }) => appLinks.newProduct("bundle", storeId),
    permission: "manageProducts",
  },
  "new-customer": {
    href: ({ storeId }) => appLinks.newCustomer(storeId),
    permission: "manageCustomers",
  },
  "new-supplier": { href: () => appLinks.newSupplier(), permission: "viewSuppliers" },
  "new-employee": { href: () => appLinks.newEmployee(), permission: "manageUsers" },
  "new-store": { href: () => appLinks.newStore(), permission: "viewStores" },
  "open-baam": { href: () => appRoutes.baam, permission: "viewReports" },
  cash: { href: () => buildPosCashMovementHref(), permission: "viewCash" },
  "finance-income": { href: () => buildPosCashMovementHref("PAY_IN"), permission: "viewCash" },
  "finance-expense": { href: () => buildPosCashMovementHref("PAY_OUT"), permission: "viewCash" },
} satisfies Record<string, CommandDestination>;

export type CommandId = keyof typeof commandDestinations;

export const commandDestination = (id: CommandId, context: CommandContext = {}) => {
  const destination: CommandDestination = commandDestinations[id];
  return { href: destination.href(context), permission: destination.permission };
};

export const canNavigateCommand = (
  access: RoleAccess,
  item: { href: string; permission?: AppPermission },
) => {
  // A missing/expired session must not inherit the default STAFF permissions.
  if (!access.role || !["ADMIN", "MANAGER", "STAFF", "CASHIER"].includes(access.role)) return false;
  if (!item.href.startsWith("/") || item.href.startsWith("//")) return false;
  const pathname = item.href.split(/[?#]/, 1)[0];
  return (
    Boolean(item.permission) &&
    hasPermission(access, item.permission) &&
    canAccessAppRoute(pathname, access)
  );
};

export const searchResultDestination = (item: {
  type: "product" | "supplier" | "store" | "purchaseOrder";
  id: string;
  label: string;
}) => ({
  href:
    item.type === "product"
      ? appLinks.product(item.id)
      : item.type === "purchaseOrder"
        ? appLinks.purchaseOrder(item.id)
        : item.type === "supplier"
          ? appLinks.supplierSearch(item.label)
          : appRoutes.stores,
  permission: permissionForSearchResultType(item.type),
});
