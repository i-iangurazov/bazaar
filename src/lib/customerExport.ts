export const CUSTOMER_EXPORT_COLUMN_KEYS = [
  "name",
  "email",
  "phone",
  "address",
  "source",
  "createdAt",
  "lastPurchase",
  "totalPurchases",
] as const;

export type CustomerExportColumnKey = (typeof CUSTOMER_EXPORT_COLUMN_KEYS)[number];

export type CustomerExportRecord = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  source: string;
  createdAt: Date | string;
  lastOrderAt: Date | string | null;
  orderCount: number;
};

const getCustomerExportValue = (
  customer: CustomerExportRecord,
  column: CustomerExportColumnKey,
  input: {
    formatDate: (value: Date | string) => string;
    formatSource: (source: string) => string;
  },
) => {
  switch (column) {
    case "name":
      return customer.name;
    case "email":
      return customer.email ?? "";
    case "phone":
      return customer.phone ?? "";
    case "address":
      return customer.address ?? "";
    case "source":
      return input.formatSource(customer.source);
    case "createdAt":
      return input.formatDate(customer.createdAt);
    case "lastPurchase":
      return customer.lastOrderAt ? input.formatDate(customer.lastOrderAt) : "";
    case "totalPurchases":
      return String(customer.orderCount);
  }
};

export const buildCustomerExportTable = (input: {
  customers: CustomerExportRecord[];
  selectedColumns: CustomerExportColumnKey[];
  labels: Record<CustomerExportColumnKey, string>;
  formatDate: (value: Date | string) => string;
  formatSource: (source: string) => string;
}) => {
  const selectedColumnSet = new Set(input.selectedColumns);
  const columns = CUSTOMER_EXPORT_COLUMN_KEYS.filter((column) => selectedColumnSet.has(column));

  return {
    header: columns.map((column) => input.labels[column]),
    rows: input.customers.map((customer) =>
      columns.map((column) => getCustomerExportValue(customer, column, input)),
    ),
  };
};
