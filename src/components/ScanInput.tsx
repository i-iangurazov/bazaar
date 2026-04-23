"use client";

import React, {
  forwardRef,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";

import { CheckIcon, EmptyIcon } from "@/components/icons";
import { ProductSearchResultItem } from "@/components/product-search-result-item";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
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
  enableProductSearch?: boolean;
  productSearchMinLength?: number;
  dataTour?: string;
};

type FeedbackState = "idle" | "success" | "error";

const hideTimeoutMs = 150;
const defaultTabSubmitMinLengthByContext: Record<ScanContext, number> = {
  global: 1,
  commandPanel: 4,
  stockCount: 1,
  pos: 1,
  linePicker: 1,
};

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
      tabSubmitMinLength,
      autoFocus,
      disabled,
      className,
      inputClassName,
      onFocus,
      onBlur,
      onKeyDown,
      showDropdown = true,
      enableProductSearch = false,
      productSearchMinLength = 2,
      dataTour,
    },
    forwardedRef,
  ) => {
    const utils = trpc.useUtils();
    const tCommon = useTranslations("common");
    const innerRef = useRef<HTMLInputElement | null>(null);
    const listboxId = useId();
    const feedbackTimerRef = useRef<number | null>(null);
    const hideTimerRef = useRef<number | null>(null);
    const controlled = typeof value === "string";
    const [internalValue, setInternalValue] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [feedback, setFeedback] = useState<FeedbackState>("idle");
    const [multipleItems, setMultipleItems] = useState<ScanLookupItem[]>([]);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [showEmptyResult, setShowEmptyResult] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [lastTrigger, setLastTrigger] = useState<ScanSubmitTrigger>("enter");

    const currentValue = controlled ? value ?? "" : internalValue;
    const deferredValue = useDeferredValue(currentValue);
    const liveSearchQuery = deferredValue.trim();
    const effectiveTabSubmitMinLength =
      tabSubmitMinLength ?? defaultTabSubmitMinLengthByContext[context];
    const liveProductSearchEnabled =
      showDropdown && enableProductSearch && !disabled && liveSearchQuery.length >= productSearchMinLength;
    const liveProductSearchQuery = trpc.products.searchQuick.useQuery(
      { q: liveSearchQuery },
      { enabled: liveProductSearchEnabled, keepPreviousData: true },
    );
    const liveProductItems: ScanLookupItem[] = liveProductSearchEnabled
      ? (liveProductSearchQuery.data ?? []).map((product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          type: product.type,
          matchType: "name",
          primaryImage: product.primaryImage ?? null,
          primaryBarcode: product.primaryBarcode ?? null,
          category: product.category ?? null,
          categories: product.categories ?? [],
          basePriceKgs: product.basePriceKgs ?? null,
          effectivePriceKgs: product.effectivePriceKgs ?? null,
          onHandQty: product.onHandQty ?? null,
        }))
      : [];
    const dropdownItems = multipleItems.length > 0 ? multipleItems : liveProductItems;
    const showLiveLoading =
      liveProductSearchEnabled && liveProductSearchQuery.isFetching && dropdownItems.length === 0;
    const showLiveEmpty =
      liveProductSearchEnabled &&
      !liveProductSearchQuery.isFetching &&
      multipleItems.length === 0 &&
      liveProductItems.length === 0;

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
      setShowEmptyResult(false);
      setActiveIndex(0);
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
        setShowEmptyResult(false);
        setActiveIndex(0);
        setFeedback("idle");
        innerRef.current?.focus();
        return;
      }

      setMultipleItems([]);
      setDropdownOpen(true);
      setShowEmptyResult(true);
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

    useEffect(() => {
      if (!enableProductSearch || !showDropdown) {
        return;
      }
      setActiveIndex(0);
      if (liveSearchQuery.length >= productSearchMinLength) {
        setDropdownOpen(true);
        setShowEmptyResult(false);
      } else if (multipleItems.length === 0) {
        setDropdownOpen(false);
      }
    }, [
      enableProductSearch,
      liveSearchQuery,
      multipleItems.length,
      productSearchMinLength,
      showDropdown,
    ]);

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) {
        return;
      }

      if (dropdownOpen && dropdownItems.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((current) => (current + 1) % dropdownItems.length);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex((current) => (current - 1 + dropdownItems.length) % dropdownItems.length);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          const selectedItem = dropdownItems[activeIndex] ?? dropdownItems[0];
          if (selectedItem) {
            void handleItemSelect(selectedItem);
          }
          return;
        }
      }

      if (dropdownOpen && event.key === "Escape") {
        event.preventDefault();
        setDropdownOpen(false);
        setShowEmptyResult(false);
        return;
      }

      const trigger = shouldSubmitFromKey({
        key: event.key,
        supportsTabSubmit,
        tabSubmitMinLength: effectiveTabSubmitMinLength,
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
          role="combobox"
          aria-expanded={showDropdown && dropdownOpen}
          aria-controls={showDropdown && dropdownOpen ? listboxId : undefined}
          aria-activedescendant={
            showDropdown && dropdownOpen && dropdownItems.length > 0
              ? `${listboxId}-${dropdownItems[activeIndex]?.id}`
              : undefined
          }
          data-tour={dataTour}
          value={currentValue}
          onChange={(event) => {
            updateValue(event.target.value);
            if (multipleItems.length > 0) {
              setMultipleItems([]);
            }
            if (showEmptyResult) {
              setShowEmptyResult(false);
            }
            if (enableProductSearch && event.target.value.trim().length >= productSearchMinLength) {
              setDropdownOpen(true);
            }
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (multipleItems.length > 0 || liveProductItems.length > 0 || showLiveLoading || showLiveEmpty) {
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
          disabled={disabled}
          inputMode="search"
          className={cn(
            "pr-9",
            feedback === "error" ? "border-danger focus-visible:ring-danger/30" : undefined,
            inputClassName,
          )}
        />
        {submitting ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Spinner className="h-4 w-4" />
          </span>
        ) : feedback === "success" ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-success">
            <CheckIcon className="h-4 w-4" aria-hidden />
          </span>
        ) : null}

        {showDropdown &&
        dropdownOpen &&
        (dropdownItems.length > 0 || showEmptyResult || showLiveLoading || showLiveEmpty) ? (
          <div
            id={listboxId}
            role="listbox"
            className="absolute z-20 mt-2 w-full overflow-hidden rounded-md border border-border bg-popover shadow-lg"
          >
            <div className="max-h-64 overflow-y-auto py-1">
              {dropdownItems.map((item, index) => (
                <ProductSearchResultItem
                  key={item.id}
                  id={`${listboxId}-${item.id}`}
                  role="option"
                  product={item}
                  active={index === activeIndex}
                  compact
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    void handleItemSelect(item);
                  }}
                />
              ))}
              {showLiveLoading ? (
                <div className="flex items-center gap-3 px-3 py-3 text-sm text-muted-foreground">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
                    <Spinner className="h-4 w-4" />
                  </span>
                  <span>{tCommon("loading")}</span>
                </div>
              ) : null}
              {(showEmptyResult || showLiveEmpty) && dropdownItems.length === 0 ? (
                <div className="flex items-center gap-3 px-3 py-3 text-sm text-muted-foreground">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-muted/40">
                    <EmptyIcon className="h-4 w-4" aria-hidden />
                  </span>
                  <span>{tCommon("nothingFound")}</span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  },
);

ScanInput.displayName = "ScanInput";
