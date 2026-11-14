"use client";

import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { parseQuantity, quantityPrecision } from "@/lib/quantity";

const quantityDraftPattern = new RegExp(`^\\d*(?:[.,]\\d{0,${quantityPrecision}})?$`);

export function PosReturnQuantityInput({
  value,
  availableQuantity,
  onChange,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "inputMode"> & {
  value: string;
  availableQuantity: number;
  onChange: (draft: string) => void;
}) {
  return (
    <Input
      {...props}
      value={value}
      inputMode="decimal"
      onChange={(event) => {
        const draft = event.target.value;
        if (!quantityDraftPattern.test(draft)) return;
        const quantity = parseQuantity(draft);
        if (quantity !== null && quantity > availableQuantity) {
          onChange(String(availableQuantity));
          return;
        }
        onChange(draft);
      }}
    />
  );
}
