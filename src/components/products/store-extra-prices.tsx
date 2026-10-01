"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { reportError } from "@/lib/reporting";

export function StoreExtraPrices(props: { storeId: string; productId: string; variantId?: string; standard: number | null; retail: number | null; wholesale: number | null; onSaved: () => void }) {
  const t = useTranslations("products"); const errors = useTranslations("errors");
  const [retail, setRetail] = useState(""); const [wholesale, setWholesale] = useState("");
  useEffect(() => { setRetail(props.retail == null ? "" : String(props.retail)); setWholesale(props.wholesale == null ? "" : String(props.wholesale)); }, [props.retail, props.wholesale, props.storeId, props.variantId]);
  const mutation = trpc.storePrices.upsert.useMutation({ onSuccess: props.onSaved });
  const valid = [retail, wholesale].every((v) => v.trim() === "" || (Number.isFinite(Number(v)) && Number(v) >= 0));
  return <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
    <div className="grid grid-cols-2 gap-2">
      <label className="space-y-1 text-xs">{t("retailPrice")} · KGS<Input type="number" min="0" step="0.01" value={retail} onChange={(e) => setRetail(e.target.value)} /></label>
      <label className="space-y-1 text-xs">{t("wholesalePrice")} · KGS<Input type="number" min="0" step="0.01" value={wholesale} onChange={(e) => setWholesale(e.target.value)} /></label>
    </div>
    <p className="text-xs text-muted-foreground">{t("additionalPricesHint")}</p>
    {mutation.error ? <p role="alert" className="text-xs text-danger">{reportError(errors, mutation.error)}</p> : null}
    <Button size="sm" variant="secondary" disabled={!valid || mutation.isLoading} onClick={() => mutation.mutate({storeId: props.storeId, productId: props.productId, variantId: props.variantId, retailPriceKgs: retail.trim() === "" ? null : Number(retail), wholesalePriceKgs: wholesale.trim() === "" ? null : Number(wholesale)})}>{t("saveAdditionalPrices")}</Button>
  </div>;
}
