// Shared destinations for the sidebar, command panel and route aliases.
export const appRoutes = {
  pos: "/pos",
  sell: "/pos/sell",
  salesHistory: "/pos/history",
  shifts: "/pos/shifts",
  products: "/products",
  newProduct: "/products/new",
  inventory: "/inventory",
  movements: "/inventory/movements",
  receiving: "/inventory/receiving",
  transfers: "/inventory/transfers",
  writeOffs: "/inventory/write-offs",
  counts: "/inventory/counts",
  customers: "/customers",
  suppliers: "/suppliers",
  stores: "/stores",
  users: "/settings/users",
  purchaseOrders: "/purchase-orders",
  baam: "/baam",
} as const;

const withQuery = (path: string, values: Record<string, string | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) query.set(key, value);
  }
  return query.size ? `${path}?${query}` : path;
};

// Each builder accepts only context supported by that destination's page.
export const appLinks = {
  product: (id: string) => `${appRoutes.products}/${encodeURIComponent(id)}`,
  purchaseOrder: (id: string) => `${appRoutes.purchaseOrders}/${encodeURIComponent(id)}`,
  newProduct: (type: "product" | "bundle", storeId?: string) =>
    withQuery(appRoutes.newProduct, { type, storeId }),
  newCustomer: (storeId?: string) => withQuery(appRoutes.customers, { add: "1", storeId }),
  newSupplier: () => withQuery(appRoutes.suppliers, { create: "1" }),
  newStore: () => withQuery(appRoutes.stores, { create: "1" }),
  newEmployee: () => withQuery(appRoutes.users, { create: "1" }),
  newCount: (storeId?: string) => withQuery(appRoutes.counts, { create: "1", storeId }),
  transfer: (fromStoreId?: string) => withQuery(appRoutes.transfers, { fromStoreId }),
  writeOff: (storeId?: string) => withQuery(appRoutes.writeOffs, { storeId }),
  supplierSearch: (name: string) => withQuery(appRoutes.suppliers, { q: name }),
};
