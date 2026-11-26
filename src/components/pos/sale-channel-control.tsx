"use client";
import { useTranslations } from "next-intl";
import { CheckIcon } from "@/components/icons";
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
    <label
      className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        if (event.target instanceof HTMLInputElement) return;
        // Native label activation focuses the checkbox, taking focus from the scanner.
        event.preventDefault();
        if (!props.disabled) props.onChange(props.value === "ONLINE" ? "IN_STORE" : "ONLINE");
      }}
    >
      <span className="relative grid h-5 w-5 shrink-0 place-items-center">
        <input
          type="checkbox"
          className="peer m-0 h-full w-full cursor-[inherit] appearance-none rounded-[5px] border border-input bg-card checked:border-primary checked:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          data-testid="pos-online-sale"
          checked={props.value === "ONLINE"}
          disabled={props.disabled}
          onKeyDown={(event) => event.stopPropagation()}
          onChange={(event) => props.onChange(event.target.checked ? "ONLINE" : "IN_STORE")}
        />
        <CheckIcon className="pointer-events-none absolute h-3.5 w-3.5 text-primary-foreground opacity-0 peer-checked:opacity-100" aria-hidden />
      </span>
      <span>{t("checkbox")}</span>
    </label>
  );
}
