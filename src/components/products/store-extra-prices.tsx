"use client";
import { useEffect, useRef, useState } from "react";
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
  const dirty = useRef({ retail: false, wholesale: false });
  const identity = `${props.productId}:${props.storeId}:${props.variantId ?? "BASE"}:${currency}:${rate}`;
  const previousIdentity = useRef(identity);
  useEffect(() => {
    if (previousIdentity.current !== identity) {
      dirty.current = { retail: false, wholesale: false };
      previousIdentity.current = identity;
    }
    if (!dirty.current.retail)
      setRetail(props.retail == null ? "" : String(convertFromKgs(props.retail, rate, currency)));
    if (!dirty.current.wholesale)
      setWholesale(
        props.wholesale == null ? "" : String(convertFromKgs(props.wholesale, rate, currency)),
      );
  }, [props.retail, props.wholesale, props.storeId, props.variantId, rate, currency, identity]);
  const mutation = trpc.storePrices.upsert.useMutation({
    onSuccess: async () => {
      dirty.current = { retail: false, wholesale: false };
      await utils.products.invalidate();
      props.onSaved();
      toast({ variant: "success", description: t("priceSaved") });
    },
  });
  const valid =
    (Boolean(props.variantId) || retail.trim() !== "") &&
    [retail, wholesale].every(
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
            onChange={(e) => {
              dirty.current.retail = true;
              setRetail(e.target.value);
            }}
          />
        </label>
        <label className="space-y-1 text-xs">
          {t("wholesalePrice")} · {currency}
          <Input
            type="number"
            min="0"
            step="0.01"
            value={wholesale}
            onChange={(e) => {
              dirty.current.wholesale = true;
              setWholesale(e.target.value);
            }}
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
        disabled={
          !valid || mutation.isLoading || (!dirty.current.retail && !dirty.current.wholesale)
        }
        onClick={() =>
          mutation.mutate({
            storeId: props.storeId,
            productId: props.productId,
            variantId: props.variantId,
            retailPriceKgs: dirty.current.retail
              ? retail.trim() === ""
                ? null
                : convertToKgs(Number(retail), rate, currency)
              : undefined,
            wholesalePriceKgs: dirty.current.wholesale
              ? wholesale.trim() === ""
                ? null
                : convertToKgs(Number(wholesale), rate, currency)
              : undefined,
          })
        }
      >
        {t("saveAdditionalPrices")}
      </Button>
    </div>
  );
}
