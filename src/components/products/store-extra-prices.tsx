"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { reportError } from "@/lib/reporting";
import {
  convertFromKgs,
  convertToKgs,
  normalizeCurrencyCode,
  normalizeCurrencyRateKgsPerUnit,
} from "@/lib/currency";
import { useToast } from "@/components/ui/toast";

export function StoreExtraPrices(props: {
  storeId: string;
  productId: string;
  variantId?: string;
  currencyCode?: string | null;
  currencyRateKgsPerUnit?: number;
  retail: number | null;
  wholesale: number | null;
  onSaved: () => void;
}) {
  const t = useTranslations("products");
  const errors = useTranslations("errors");
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const currency = normalizeCurrencyCode(props.currencyCode);
  const rate = normalizeCurrencyRateKgsPerUnit(props.currencyRateKgsPerUnit, currency);
  const [retail, setRetail] = useState("");
  const [wholesale, setWholesale] = useState("");
  useEffect(() => {
    setRetail(props.retail == null ? "" : String(convertFromKgs(props.retail, rate, currency)));
    setWholesale(
      props.wholesale == null ? "" : String(convertFromKgs(props.wholesale, rate, currency)),
    );
  }, [props.retail, props.wholesale, props.storeId, props.variantId, rate, currency]);
  const mutation = trpc.storePrices.upsert.useMutation({
    onSuccess: async () => {
      await utils.products.invalidate();
      props.onSaved();
      toast({ variant: "success", description: t("priceSaved") });
    },
  });
  const valid = (Boolean(props.variantId) || retail.trim() !== "") && [retail, wholesale].every(
    (v) => v.trim() === "" || (Number.isFinite(Number(v)) && Number(v) >= 0),
  );
  return (
    <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs">
          {t("retailPrice")} · {currency}
          <Input
            type="number"
            min="0"
            step="0.01"
            aria-required={!props.variantId}
            placeholder={t("retailPricePlaceholder")}
            value={retail}
            onChange={(e) => setRetail(e.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs">
          {t("wholesalePrice")} · {currency}
          <Input
            type="number"
            min="0"
            step="0.01"
            value={wholesale}
            onChange={(e) => setWholesale(e.target.value)}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{t("additionalPricesHint")}</p>
      {mutation.error ? (
        <p role="alert" className="text-xs text-danger">
          {reportError(errors, mutation.error)}
        </p>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        disabled={!valid || mutation.isLoading}
        onClick={() =>
          mutation.mutate({
            storeId: props.storeId,
            productId: props.productId,
            variantId: props.variantId,
            retailPriceKgs:
              retail.trim() === "" ? null : convertToKgs(Number(retail), rate, currency),
            wholesalePriceKgs:
              wholesale.trim() === "" ? null : convertToKgs(Number(wholesale), rate, currency),
          })
        }
      >
        {t("saveAdditionalPrices")}
      </Button>
    </div>
  );
}
