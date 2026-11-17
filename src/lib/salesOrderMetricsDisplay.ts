import { formatNumber } from "@/lib/i18nFormat";

export type SalesOrderMetricsSummaryLike = {
  missingCostLines: number;
  totalCostKgs: number;
  totalProfitKgs: number;
  marginPct: number;
};

export type SalesOrderMetricsProfitability =
  | {
      costsComplete: true;
      costKgs: number;
      profitKgs: number;
      marginPct: number;
    }
  | {
      costsComplete: false;
      costKgs: null;
      profitKgs: null;
      marginPct: null;
    };

/**
 * Cost, profit and margin are only meaningful when every line has a known
 * cost. A partial cost base would otherwise turn unknown cost into zero and
 * show a fabricated 100% margin.
 */
export const salesOrderMetricsProfitability = (
  summary: SalesOrderMetricsSummaryLike,
): SalesOrderMetricsProfitability =>
  summary.missingCostLines > 0
    ? { costsComplete: false, costKgs: null, profitKgs: null, marginPct: null }
    : {
        costsComplete: true,
        costKgs: summary.totalCostKgs,
        profitKgs: summary.totalProfitKgs,
        marginPct: summary.marginPct,
      };

/** Trend rows share the summary's cost completeness gate. */
export const salesOrderMetricsTrendMoney = (
  valueKgs: number,
  costsComplete: boolean,
): number | null => (costsComplete ? valueKgs : null);

/** Locale-aware margin text; null means the margin was not calculated. */
export const formatSalesOrderMargin = (marginPct: number | null, locale: string) =>
  marginPct === null
    ? "—"
    : `${formatNumber(marginPct, locale, { maximumFractionDigits: 2 })}%`;
