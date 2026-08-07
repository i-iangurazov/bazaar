export const helpCaptureTargets = [
  { name: "products-list", path: "/products", width: 1440, height: 900 },
  { name: "product-create", path: "/products/new", width: 1440, height: 900 },
  { name: "receiving", path: "/inventory/receiving", width: 1440, height: 900 },
  { name: "transfer", path: "/inventory/transfers", width: 1440, height: 900 },
  { name: "write-off", path: "/inventory/write-offs", width: 1440, height: 900 },
  { name: "inventory-count", path: "/inventory/counts", width: 1440, height: 900 },
  { name: "pos-desktop", path: "/pos/sell", width: 1440, height: 1000 },
  { name: "pos-mobile", path: "/pos/sell", width: 390, height: 844 },
  { name: "shift-close", path: "/pos/shifts", width: 1440, height: 900 },
  { name: "analytics", path: "/reports/analytics", width: 1440, height: 900 },
] as const;
