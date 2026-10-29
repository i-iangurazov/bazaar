import { z } from "zod";

// A finite read contract, not SQL or an instruction to call arbitrary routers.
// Entity IDs, authorization and all arithmetic remain server responsibilities.
export const baamReadRequestSchema = z
  .object({
    dataset: z.enum([
      "sales_metrics",
      "products",
      "sales",
      "orders",
      "returns",
      "customers",
      "suppliers",
      "purchases",
      "stock_counts",
      "stock_movements",
      "inventory",
      "stores",
    ]),
    mode: z.enum([
      "summary",
      "comparison",
      "daily",
      "list",
      "latest",
      "new",
      "drafts",
      "details",
      "catalog_details",
      "top",
      "bottom",
      "zero_sales",
      "low_stock",
      "negative_stock",
      "empty_stock",
    ]),
    query: z.string().trim().max(160).nullable(),
    store: z.string().trim().max(100).nullable(),
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    limit: z.number().int().min(1).max(50),
    metric: z.enum(["revenue", "units", "return_units"]).nullable(),
    movementType: z
      .enum(["RECEIVE", "SALE", "RETURN", "ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT", "WRITE_OFF"])
      .nullable(),
    stockThreshold: z.number().min(0).max(1000000).nullable(),
  })
  .strict();
export const baamReadPlanSchema = z
  .object({
    requests: z.array(baamReadRequestSchema).max(6),
    format: z.enum(["auto", "short", "table", "list", "explanation"]),
    clarification: z.string().max(1200).nullable(),
  })
  .strict();
export type BaamReadRequest = z.infer<typeof baamReadRequestSchema>;
export type BaamReadPlan = z.infer<typeof baamReadPlanSchema>;
// Domain meanings are explicit because a customer order and a POS receipt share
// storage internally, but are different workflows in the product.
export const baamReadDomains = {
  sales_metrics:
    "Aggregates of completed POS checkout sales and refunds, not customer-order totals.",
  products:
    "Catalog search/current fields, period product sales performance/rankings. Stock quantities use inventory.",
  sales:
    "POS CASH-REGISTER RECEIPTS/checks (кассовые чеки, продажи в кассе). Latest is one completed checkout. Drafts are unpaid carts. These are NOT customer orders.",
  orders:
    "CUSTOMER ORDERS (заказы клиентов/покупателей, кардардын буйрутмасы) from the separate Orders section, EXCLUDING all POS receipts/carts. Use this even when no orders exist; NEVER substitute cash-register sales or drafts.",
  returns: "Completed or recorded POS return documents, not purchase orders or customer profiles.",
  customers:
    "Customer CONTACTS/profiles and registration dates, not their orders. A customer's order/status uses orders.",
  suppliers: "Supplier CONTACTS/profiles, not purchase-order documents.",
  purchases:
    "Orders placed TO SUPPLIERS (заказы поставщикам), not orders from customers or stock-receiving documents.",
  stock_counts:
    "Stock-count/inventory-count documents, including unapplied drafts; not current inventory quantities.",
  stock_movements:
    "Posted stock documents: receipts, write-offs, transfers and other movements. A stock receipt is not an order to a supplier.",
  inventory:
    "Current stock snapshots per product/variant/store, optional explicit thresholds. Not historical stock or document counts.",
  stores: "Only stores accessible to the current actor; not a grant of new permissions.",
} as const;
export type BaamReadSection = {
  title: string;
  scope: string;
  storeNames: string[];
  periodLabel: string;
  needsSelection?: boolean;
  facts: Array<{ label: string; value: string }>;
  records: Array<{
    id: string;
    title: string;
    href: string;
    sku: string | null;
    displayFields: Array<{ label: string; value: string }>;
  }>;
  notes: string[];
  href: string;
};

// Each model-facing operation has a single meaning. Unsupported combinations
// cannot silently become a whole-store read (e.g. SKU + sales summary).
export const baamReadOperations = {
  sales_summary: ["sales_metrics", "summary"],
  sales_comparison: ["sales_metrics", "comparison"],
  sales_daily: ["sales_metrics", "daily"],
  products_search: ["products", "list"],
  products_top: ["products", "top"],
  products_bottom: ["products", "bottom"],
  products_unsold: ["products", "zero_sales"],
  products_performance: ["products", "details"],
  products_details: ["products", "catalog_details"],
  products_returns: ["products", "top"],
  sales_list: ["sales", "list"],
  sales_latest: ["sales", "latest"],
  sales_details: ["sales", "details"],
  sales_drafts: ["sales", "drafts"],
  orders_list: ["orders", "list"],
  orders_latest: ["orders", "latest"],
  orders_drafts: ["orders", "drafts"],
  returns_list: ["returns", "list"],
  returns_latest: ["returns", "latest"],
  customers_list: ["customers", "list"],
  customers_new: ["customers", "new"],
  customers_latest: ["customers", "latest"],
  customers_details: ["customers", "details"],
  suppliers_list: ["suppliers", "list"],
  suppliers_latest: ["suppliers", "latest"],
  suppliers_details: ["suppliers", "details"],
  purchases_list: ["purchases", "list"],
  purchases_latest: ["purchases", "latest"],
  purchases_drafts: ["purchases", "drafts"],
  stock_counts_list: ["stock_counts", "list"],
  stock_counts_latest: ["stock_counts", "latest"],
  stock_counts_drafts: ["stock_counts", "drafts"],
  stock_receipts_list: ["stock_movements", "list"],
  stock_receipts_latest: ["stock_movements", "latest"],
  stock_movements_list: ["stock_movements", "list"],
  stock_movements_latest: ["stock_movements", "latest"],
  stock_transfers_list: ["stock_movements", "list"],
  stock_writeoffs_list: ["stock_movements", "list"],
  inventory_list: ["inventory", "list"],
  inventory_low: ["inventory", "low_stock"],
  inventory_negative: ["inventory", "negative_stock"],
  inventory_empty: ["inventory", "empty_stock"],
  stores_list: ["stores", "list"],
} as const;
const operationNames = Object.keys(baamReadOperations) as [
  keyof typeof baamReadOperations,
  ...Array<keyof typeof baamReadOperations>,
];
export const baamReadModelPlanSchema = z
  .object({
    requests: z
      .array(
        baamReadRequestSchema
          .omit({ dataset: true, mode: true })
          .extend({
            operation: z.enum(operationNames),
          })
          .strict(),
      )
      .max(6),
    format: z
      .enum(["auto", "short", "table", "list", "explanation"])
      .describe(
        "short for any explicit brevity constraint, including explain in two sentences; explanation only for detailed explanations. Otherwise honor table/list or use auto.",
      ),
    clarification: z.string().max(1200).nullable(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (!plan.requests.length && !plan.clarification?.trim())
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "An empty read plan needs a specific useful clarification or explanation of the unavailable data, never a generic menu.",
      });
    plan.requests.forEach((r, i) => {
      if (r.operation.endsWith("_latest") && r.limit !== 1)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["requests", i, "limit"],
          message:
            "A latest operation returns ONE item and requires limit 1. Last N records (N > 1) require the corresponding list operation with limit N. Never discard the requested count.",
        });
      if (
        ["products_top", "products_bottom", "products_unsold", "products_returns"].includes(
          r.operation,
        ) &&
        r.query
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["requests", i],
          message:
            "These catalog-wide rankings do not accept a product/category filter. Never silently discard a requested filter. Offer products_search/products_performance or explain the exact limitation.",
        });
      if (
        r.operation.startsWith("sales_") &&
        ["sales_summary", "sales_comparison", "sales_daily"].includes(r.operation) &&
        r.query
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["requests", i],
          message:
            "A product/SKU query MUST use products_performance, never whole-store sales_summary/comparison/daily.",
        });
      if (Boolean(r.dateFrom) !== Boolean(r.dateTo))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["requests", i],
          message: "Both dateFrom and dateTo are required together.",
        });
    });
  })
  .transform((plan) => ({
    ...plan,
    requests: plan.requests.map(({ operation, ...r }): BaamReadRequest => {
      const [dataset, mode] = baamReadOperations[operation];
      return {
        ...r,
        dataset,
        mode,
        limit: mode === "latest" ? 1 : r.limit,
        metric: operation === "products_returns" ? "return_units" : r.metric,
        movementType: operation.startsWith("stock_receipts_")
          ? "RECEIVE"
          : operation === "stock_transfers_list"
            ? "TRANSFER_IN"
            : operation === "stock_writeoffs_list"
              ? "WRITE_OFF"
              : r.movementType,
      };
    }),
  }));
