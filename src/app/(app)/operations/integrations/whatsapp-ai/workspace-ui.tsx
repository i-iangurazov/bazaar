"use client";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { translateError } from "@/lib/translateError";
import { useToast } from "@/components/ui/toast";

export type Workspace = inferRouterOutputs<AppRouter>["whatsappAi"]["workspace"];
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="grid gap-2 text-sm">
      {label}
      {children}
    </Label>
  );
}
export function Choice({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
export function useFeedback() {
  const t = useTranslations("whatsappAi"),
    errors = useTranslations("errors"),
    { toast } = useToast();
  return {
    success: () => toast({ variant: "success", description: t("saved") }),
    error: (error: Parameters<typeof translateError>[1]) =>
      toast({ variant: "error", description: translateError(errors, error) }),
  };
}
