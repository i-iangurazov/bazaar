"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { useTranslations } from "next-intl";
import { CloseIcon } from "@/components/icons";
import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ProductNameInputProps = InputProps & { onClear: () => void };

export const ProductNameInput = forwardRef<HTMLInputElement, ProductNameInputProps>(
  ({ onClear, value, className, disabled, readOnly, ...props }, forwardedRef) => {
    const t = useTranslations("products");
    const input = useRef<HTMLInputElement>(null);
    useImperativeHandle(forwardedRef, () => input.current as HTMLInputElement);

    return (
      <div className="relative w-full min-w-0">
        <Input
          {...props}
          ref={input}
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          className={cn("pr-11", className)}
        />
        {value && !disabled && !readOnly ? (
          <button
            type="button"
            aria-label={t("clearName")}
            title={t("clearName")}
            className="absolute right-0 top-0 flex h-full w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              onClear();
              input.current?.focus({ preventScroll: true });
            }}
          >
            <CloseIcon className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>
    );
  },
);
ProductNameInput.displayName = "ProductNameInput";
