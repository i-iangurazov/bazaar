import { formatCurrency, formatNumber } from "@/lib/i18nFormat";

/** Format once on the server: browsers may lack the server's Kyrgyz ICU locale. */
export function getMarketingPreviewData(locale: string) {
  const money = (value: number) => formatCurrency(value, locale, "KGS");
  const number = (value: number) => formatNumber(value, locale);
  return {
    revenue: money(42850),
    receipts: number(36),
    average: money(1190.28),
    amounts: [375, 290, 160, 65].map(money),
    stock: [24, 18, 42, 60].map(number),
    cartAmounts: [750, 290].map(money),
    total: money(1040),
    quantities: [24, 6, 2, 18].map(number),
    customerOrders: [8, 12, 5].map(number),
    customerTotals: [9420, 15750, 6280].map(money),
  };
}
export type MarketingPreviewData = ReturnType<typeof getMarketingPreviewData>;
