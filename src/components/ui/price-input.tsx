"use client";

import * as React from "react";

import { Input, type InputProps } from "@/components/ui/input";

export type PriceInputProps = Omit<InputProps, "type" | "inputMode">;

// Native number inputs can discard the comma supplied by an iOS decimal keyboard.
// Keep the exact draft (including a trailing separator); validate/normalize only on commit.
export const PriceInput = React.forwardRef<HTMLInputElement, PriceInputProps>((props, ref) => (
  <Input {...props} ref={ref} type="text" inputMode="decimal" />
));

PriceInput.displayName = "PriceInput";
