"use client";

import { useLocale, useTranslations } from "next-intl";
import type { KeyboardEventHandler, Ref } from "react";
import { Label } from "@/components/ui/label";
import { PriceInput } from "@/components/ui/price-input";
import { Spinner } from "@/components/ui/spinner";
import { formatCurrencyKGS } from "@/lib/i18nFormat";
import { formatKgsMoney } from "@/lib/currencyDisplay";
import { parsePriceInput } from "@/lib/priceInput";
import { convertToKgs, normalizeCurrencyCode } from "@/lib/currency";
import type { ReceivingCommercePreview, ReceivingCostState } from "@/lib/stockReceivingCommerce";

type PreviewLine = ReceivingCommercePreview["lines"][number];
const reasonKeys = new Set([
  "UNVALUED_STOCK", "NEGATIVE_STOCK", "SNAPSHOT_MISMATCH", "HISTORY_LIMIT",
  "MISSING_TRANSFER", "MISSING_RETURN", "AMBIGUOUS_CORRECTION", "BACKDATED",
  "INVALID_HISTORY", "NO_STOCK",
]);

export function ReceivingCommerceLine({
  lineKey, context, valuation, currencyCode, currencyRateKgsPerUnit,
  saleInput, onSaleChange, onSaleFocus, onSaleKeyDown, inputRef,
  pricingAllowed, loading, disabled,
}: {
  lineKey: string;
  context?: PreviewLine;
  valuation?: PreviewLine["valuation"];
  currencyCode: string;
  currencyRateKgsPerUnit: number;
  saleInput: string;
  onSaleChange: (value: string) => void;
  onSaleFocus: () => void;
  onSaleKeyDown: KeyboardEventHandler<HTMLInputElement>;
  inputRef: Ref<HTMLInputElement>;
  pricingAllowed: boolean;
  loading: boolean;
  disabled: boolean;
}) {
  const t = useTranslations("inventory.receivingPricing");
  const locale = useLocale();
  const saleId = `receiving-sale-${lineKey.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const parsedSale = saleInput.trim() ? parsePriceInput(saleInput) : null;
  const invalidSale = Boolean(saleInput.trim() && (parsedSale === null || parsedSale < 0));
  const changesShared = Boolean(context?.sharedRetail && parsedSale !== null &&
    Number(convertToKgs(parsedSale, currencyRateKgsPerUnit, normalizeCurrencyCode(currencyCode)).toFixed(2)) !== context.currentSalePriceKgs);
  const cost = (state?: ReceivingCostState) => {
    if (loading) return <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Spinner className="h-3.5 w-3.5" />{t("checking")}</span>;
    if (state?.status === "KNOWN" && state.unitCostKgs !== null)
      return <span className="font-semibold text-foreground" data-receiving-cost-state="KNOWN">{formatCurrencyKGS(state.unitCostKgs, locale)}</span>;
    const reason = state?.reason && reasonKeys.has(state.reason) ? state.reason : "INVALID_HISTORY";
    return <span className="text-muted-foreground" data-receiving-cost-state="UNKNOWN" aria-label={t(`reasons.${reason}`)}>{state?.reason === "NO_STOCK" ? t("noStock") : t("unknown")}</span>;
  };
  return (
    <div className="col-span-full min-w-0 border-t border-border/60 pt-3" data-receiving-commerce-line>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t("costTitle")}</p>
          <dl className="grid grid-cols-2 gap-2 text-xs leading-5">
            <div className="min-w-0"><dt className="text-muted-foreground">{t("before")}</dt><dd className="break-words">{cost(valuation?.current)}</dd></div>
            <div className="min-w-0"><dt className="text-muted-foreground">{t("after")}</dt><dd className="break-words">{cost(valuation?.projected)}</dd></div>
          </dl>
          {!loading && valuation?.projected.status === "UNKNOWN" && valuation.projected.reason !== "NO_STOCK" ? (
            <p className="text-[11px] leading-4 text-muted-foreground">{t(`reasons.${reasonKeys.has(valuation.projected.reason ?? "") ? valuation.projected.reason : "INVALID_HISTORY"}`)}</p>
          ) : null}
        </div>
        <div className="min-w-0 space-y-1">
          <Label className="text-xs" htmlFor={saleId}>{t("saleLabel", { currency: currencyCode, unit: context?.unitLabel ? ` / ${context.unitLabel}` : "" })}</Label>
          <PriceInput id={saleId} ref={inputRef} value={saleInput} onChange={event => onSaleChange(event.target.value)}
            onFocus={onSaleFocus} onKeyDown={onSaleKeyDown} disabled={disabled || !pricingAllowed || !context}
            placeholder={t("keepPrice")} aria-invalid={invalidSale || undefined} min={0} step="0.01"
            data-receiving-input="salePrice" className="h-8 px-2" />
          <p className="text-[11px] leading-4 text-muted-foreground">
            {t("currentSale", { price: context?.currentSalePriceKgs == null ? t("unknown") : formatKgsMoney(context.currentSalePriceKgs, locale, { currencyCode, currencyRateKgsPerUnit }) })}
            {" · "}{t("discountsKept")}
          </p>
          {invalidSale ? <p className="text-xs text-danger">{t("invalidSale")}</p> : null}
          {changesShared ? <p className="text-[11px] leading-4 text-warning">{t("sharedWarning")}</p> : null}
        </div>
      </div>
    </div>
  );
}
