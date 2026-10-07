"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { useTranslations } from "next-intl";
import { CloseIcon, SearchIcon } from "@/components/icons";
import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SearchInputProps = Omit<InputProps, "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (value: string) => void;
};

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ value, onValueChange, className, disabled, onKeyDown, ...props }, forwardedRef) => {
    const t = useTranslations("common");
    const input = useRef<HTMLInputElement>(null);
    useImperativeHandle(forwardedRef, () => input.current as HTMLInputElement);
    return (
      <div className="relative min-w-0 flex-1">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          {...props}
          aria-label={props["aria-label"] ?? props.placeholder}
          ref={input}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          value={value}
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (!event.nativeEvent.isComposing && event.keyCode !== 229) onKeyDown?.(event);
          }}
          className={cn("pl-9 pr-11 [&::-webkit-search-cancel-button]:appearance-none", className)}
        />
        {value ? (
          <button
            type="button"
            aria-label={t("clearSearch")}
            disabled={disabled}
            className="absolute right-0 top-0 flex h-full w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onValueChange("");
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
SearchInput.displayName = "SearchInput";
