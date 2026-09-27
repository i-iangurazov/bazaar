"use client";
import { useTranslations } from "next-intl";
import { isPosSaleChannelEnabled } from "@/lib/featureFlags";
import type { CommercialSaleChannel } from "@/lib/usePosSaleChannel";

export function SaleChannelControl(props: {
  value: CommercialSaleChannel;
  onChange: (value: CommercialSaleChannel) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("saleChannel");
  if (!isPosSaleChannelEnabled()) return null;
  return (
    <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        className="h-4 w-4 accent-primary"
        data-testid="pos-online-sale"
        checked={props.value === "ONLINE"}
        disabled={props.disabled}
        onMouseDown={(event) => event.preventDefault()}
        onKeyDown={(event) => event.stopPropagation()}
        onChange={(event) => props.onChange(event.target.checked ? "ONLINE" : "IN_STORE")}
      />
      {t("checkbox")}
    </label>
  );
}
