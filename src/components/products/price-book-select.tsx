"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const emptyValue = "__price_book_empty__";

type Props = {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ id: string; name: string }>;
  placeholder?: string;
  emptyLabel?: string;
};

/** Keep optional filters clearable without passing Radix's reserved empty item value. */
export function PriceBookSelect({
  label,
  value,
  onValueChange,
  options,
  placeholder,
  emptyLabel,
}: Props) {
  return (
    <Select
      value={value || (emptyLabel ? emptyValue : "")}
      onValueChange={(next) => onValueChange(next === emptyValue ? "" : next)}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {emptyLabel && <SelectItem value={emptyValue}>{emptyLabel}</SelectItem>}
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
