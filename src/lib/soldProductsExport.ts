type ProductExportRow = {
  productName: string; productSku: string; barcode: string | null; category: string | null;
  quantitySold: number; quantityReturned: number; netQuantity: number;
  grossRevenueKgs: number; returnedRevenueKgs: number; netRevenueKgs: number; averagePriceKgs: number;
  stockRemaining: number; receiptCount: number;
};

// This export represents the visible, filtered page. Monetary values use the
// same caller-supplied display formatter as the table; no second aggregation.
export const buildSoldProductsPageExport = (
  products: ProductExportRow[], formatMoney: (value: number) => string,
) => ({
  header: ["productName", "sku", "barcode", "category", "quantitySold", "quantityReturned", "netQuantity", "grossRevenue", "returns", "netRevenue", "averagePrice", "stockRemaining", "receiptCount"],
  rows: products.map((product) => [
    product.productName, product.productSku, product.barcode ?? "", product.category ?? "",
    String(product.quantitySold), String(product.quantityReturned), String(product.netQuantity),
    formatMoney(product.grossRevenueKgs), formatMoney(product.returnedRevenueKgs),
    formatMoney(product.netRevenueKgs), formatMoney(product.averagePriceKgs),
    String(product.stockRemaining), String(product.receiptCount),
  ]),
});

// All rows come from one authorized server reporting snapshot. Current stock
// is deliberately absent: this is the sales/returns export, not a stock read.
export const buildSoldProductsFilteredExport = (
  products: Array<Omit<ProductExportRow, "stockRemaining"> & { variantName?: string | null }>,
  formatMoney: (value: number) => string,
) => ({
  header: ["productName", "variantName", "sku", "barcode", "category", "quantitySold", "quantityReturned", "netQuantity", "grossRevenue", "returns", "netRevenue", "averagePrice", "receiptCount"],
  rows: products.map((product) => [
    product.productName, product.variantName ?? "", product.productSku, product.barcode ?? "", product.category ?? "",
    String(product.quantitySold), String(product.quantityReturned), String(product.netQuantity),
    formatMoney(product.grossRevenueKgs), formatMoney(product.returnedRevenueKgs),
    formatMoney(product.netRevenueKgs), formatMoney(product.averagePriceKgs), String(product.receiptCount),
  ]),
});
