"use client";

import * as React from "react";

import { HideIcon, ViewIcon } from "@/components/icons";
import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<InputProps, "type"> & {
  defaultVisible?: boolean;
  hideLabel?: string;
  showLabel?: string;
  toggleDisabled?: boolean;
  visible?: boolean;
  wrapperClassName?: string;
  onVisibleChange?: (visible: boolean) => void;
};

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  (
    {
      className,
      defaultVisible = false,
      disabled,
      hideLabel = "Hide value",
      showLabel = "Show value",
      toggleDisabled,
      visible,
      wrapperClassName,
      onVisibleChange,
      ...props
    },
    ref,
  ) => {
    const [internalVisible, setInternalVisible] = React.useState(defaultVisible);
    const isVisible = visible ?? internalVisible;

    const handleToggle = () => {
      const nextVisible = !isVisible;
      if (visible === undefined) {
        setInternalVisible(nextVisible);
      }
      onVisibleChange?.(nextVisible);
    };

    return (
      <div className={cn("relative", wrapperClassName)}>
        <Input
          {...props}
          ref={ref}
          type={isVisible ? "text" : "password"}
          disabled={disabled}
          className={cn("pr-10", className)}
        />
        <button
          type="button"
          className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50"
          onClick={handleToggle}
          disabled={toggleDisabled ?? disabled}
          aria-label={isVisible ? hideLabel : showLabel}
          aria-pressed={isVisible}
        >
          {isVisible ? (
            <HideIcon className="h-4 w-4" aria-hidden />
          ) : (
            <ViewIcon className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
    );
  },
);

PasswordInput.displayName = "PasswordInput";
