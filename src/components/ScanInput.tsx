"use client";

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { CheckIcon } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { normalizeScanValue } from "@/lib/scanning/normalize";
import {
  resolveScanResult,
  shouldSubmitFromKey,
  type ScanContext,
  type ScanLookupItem,
  type ScanResolvedResult,
  type ScanSubmitTrigger,
} from "@/lib/scanning/scanRouter";

type ScanInputSubmitPayload = {
  rawValue: string;
  normalizedValue: string;
  trigger: ScanSubmitTrigger;
};

type ScanInputProps = {
  context: ScanContext;
  placeholder: string;
  ariaLabel: string;
  value?: string;
  onValueChange?: (value: string) => void;
  onResolved?: (result: ScanResolvedResult) => void | boolean | Promise<void | boolean>;
  onSubmitValue?: (payload: ScanInputSubmitPayload) => void | boolean | Promise<void | boolean>;
  supportsTabSubmit?: boolean;
  tabSubmitMinLength?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  showDropdown?: boolean;
  dataTour?: string;
};

type FeedbackState = "idle" | "success" | "error";

const hideTimeoutMs = 150;

export const ScanInput = forwardRef<HTMLInputElement, ScanInputProps>(
  (
    {
      context,
      placeholder,
      ariaLabel,
      value,
      onValueChange,
      onResolved,
      onSubmitValue,
      supportsTabSubmit = false,
      tabSubmitMinLength = 4,
      autoFocus,
      disabled,
      className,
      inputClassName,
      onFocus,
      onBlur,
      onKeyDown,
      showDropdown = true,
      dataTour,
    },
    forwardedRef,
  ) => {
    const utils = trpc.useUtils();
    const innerRef = useRef<HTMLInputElement | null>(null);
    const feedbackTimerRef = useRef<number | null>(null);
    const hideTimerRef = useRef<number | null>(null);
    const controlled = typeof value === "string";
    const [internalValue, setInternalValue] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [feedback, setFeedback] = useState<FeedbackState>("idle");
    const [multipleItems, setMultipleItems] = useState<ScanLookupItem[]>([]);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [lastTrigger, setLastTrigger] = useState<ScanSubmitTrigger>("enter");

    const currentValue = controlled ? value ?? "" : internalValue;

    useImperativeHandle(forwardedRef, () => innerRef.current as HTMLInputElement, []);

    useEffect(
      () => () => {
        if (feedbackTimerRef.current) {
          window.clearTimeout(feedbackTimerRef.current);
        }
        if (hideTimerRef.current) {
          window.clearTimeout(hideTimerRef.current);
        }
      },
      [],
    );

    const updateValue = (nextValue: string) => {
      if (!controlled) {
        setInternalValue(nextValue);
      }
      onValueChange?.(nextValue);
    };

    const resetFeedbackLater = () => {
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
      }
      feedbackTimerRef.current = window.setTimeout(() => {
        setFeedback("idle");
      }, 700);
    };

    const clearInput = () => {
      updateValue("");
      setMultipleItems([]);
      setDropdownOpen(false);
    };

    const focusAndSelect = () => {
      innerRef.current?.focus();
      innerRef.current?.select();
    };

    const handleResolved = async (resolved: ScanResolvedResult) => {
      const handled = (await onResolved?.(resolved)) !== false;

      if (resolved.kind === "exact") {
        if (handled) {
          clearInput();
          setFeedback("success");
          resetFeedbackLater();
        }
        return;
      }

      if (resolved.kind === "multiple") {
        setMultipleItems(resolved.items.slice(0, 10));
        setDropdownOpen(true);
        setFeedback("idle");
        innerRef.current?.focus();
        return;
      }

      setFeedback("error");
      resetFeedbackLater();
      focusAndSelect();
    };

    const handleSubmit = async (trigger: ScanSubmitTrigger) => {
      const normalizedValue = normalizeScanValue(currentValue);
      if (!normalizedValue || submitting) {
        return;
      }

      setLastTrigger(trigger);
      setSubmitting(true);

      try {
        if (onSubmitValue) {
          const handled =
            (await onSubmitValue({ rawValue: currentValue, normalizedValue, trigger })) !== false;
          if (handled) {
            setFeedback("success");
            resetFeedbackLater();
            clearInput();
          } else {
            setFeedback("error");
            resetFeedbackLater();
            focusAndSelect();
          }
          return;
        }

        const lookup = await utils.products.lookupScan.fetch({ q: normalizedValue });
        const resolved = resolveScanResult({
          context,
          trigger,
          query: normalizedValue,
          lookup,
        });
        await handleResolved(resolved);
      } catch {
        setFeedback("error");
        resetFeedbackLater();
        focusAndSelect();
      } finally {
        setSubmitting(false);
      }
    };

    const handleItemSelect = async (item: ScanLookupItem) => {
      const resolved: ScanResolvedResult = {
        kind: "exact",
        context,
        trigger: lastTrigger,
        input: normalizeScanValue(currentValue),
        item,
      };
      await handleResolved(resolved);
    };

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) {
        return;
      }

      const trigger = shouldSubmitFromKey({
        key: event.key,
        supportsTabSubmit,
        tabSubmitMinLength,
        normalizedValue: normalizeScanValue(currentValue),
      });

      if (!trigger) {
        return;
      }

      event.preventDefault();
      void handleSubmit(trigger);
    };

    return (
      <div className={cn("relative", className)}>
        <Input
          ref={innerRef}
          data-tour={dataTour}
          value={currentValue}
          onChange={(event) => {
            updateValue(event.target.value);
            if (multipleItems.length > 0) {
              setMultipleItems([]);
            }
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (multipleItems.length > 0) {
              setDropdownOpen(true);
            }
            onFocus?.();
          }}
          onBlur={() => {
            if (hideTimerRef.current) {
              window.clearTimeout(hideTimerRef.current);
            }
            hideTimerRef.current = window.setTimeout(() => {
              setDropdownOpen(false);
              onBlur?.();
            }, hideTimeoutMs);
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoFocus={autoFocus}
          disabled={disabled || submitting}
          inputMode="search"
          className={cn(
            "pr-9",
            feedback === "error" ? "border-danger focus-visible:ring-danger/30" : undefined,
            inputClassName,
          )}
        />
        {feedback === "success" ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-success">
            <CheckIcon className="h-4 w-4" aria-hidden />
          </span>
        ) : null}

        {showDropdown && dropdownOpen && multipleItems.length > 0 ? (
          <div className="absolute z-20 mt-2 w-full rounded-md border border-border bg-popover shadow-lg">
            <div className="max-h-64 overflow-y-auto py-1">
              {multipleItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full flex-col px-3 py-2 text-left text-sm transition hover:bg-accent"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    void handleItemSelect(item);
                  }}
                >
                  <span className="font-medium text-foreground">{item.name}</span>
                  <span className="text-xs text-muted-foreground">{item.sku}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  },
);

ScanInput.displayName = "ScanInput";
