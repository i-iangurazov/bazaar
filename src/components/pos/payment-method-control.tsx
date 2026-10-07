"use client";

import { PosPaymentMethod } from "@prisma/client";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { POS_CHECKOUT_PAYMENT_METHODS, posCheckoutPaymentMethod } from "@/lib/posPaymentDrafts";
import { cn } from "@/lib/utils";

export function PosPaymentMethodControl({
  value,
  onChange,
  disabled,
  compact = false,
}: {
  value: PosPaymentMethod;
  onChange: (value: PosPaymentMethod) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("pos");
  return (
    <div
      role="group"
      aria-label={t("sell.paymentMethod")}
      className="grid min-w-0 grid-cols-2 gap-1 rounded-md border border-border bg-muted/40 p-0.5"
    >
      {POS_CHECKOUT_PAYMENT_METHODS.map((method) => (
        <Button
          key={method}
          type="button"
          variant="ghost"
          aria-pressed={posCheckoutPaymentMethod(value) === method}
          disabled={disabled}
          onClick={() => onChange(method)}
          className={cn(
            "min-w-0 px-2 text-xs font-medium",
            compact ? "h-6" : "h-11",
            posCheckoutPaymentMethod(value) === method &&
              "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground",
          )}
        >
          {t(method === PosPaymentMethod.CASH ? "payments.cash" : "payments.transfer")}
        </Button>
      ))}
    </div>
  );
}
