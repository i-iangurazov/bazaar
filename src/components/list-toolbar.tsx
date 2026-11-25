"use client";
import { type ReactNode, type ComponentProps, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { CloseIcon, AdjustIcon, ChevronDownIcon } from "@/components/icons";
import { Button } from "./ui/button";
import { SearchInput } from "@/components/search-input";
import { cn } from "@/lib/utils";

export type ActiveListFilter = { key: string; label: string; onRemove: () => void };
export function ListViewOptions({ children }: { children: ReactNode }) {
  const t = useTranslations("workspace");
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <div className="min-w-0 md:contents">
      <Button
        type="button"
        variant="secondary"
        className="w-full md:hidden"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(!expanded)}
      >
        <AdjustIcon className="h-4 w-4" aria-hidden />
        {t("viewOptions")}
        <ChevronDownIcon className={cn("h-3.5 w-3.5", expanded && "rotate-180")} aria-hidden />
      </Button>
      <div id={id} className={cn("mt-3 min-w-0 md:mt-0 md:contents", !expanded && "hidden")}>
        {children}
      </div>
    </div>
  );
}
export function FilterSummary({
  filters = [],
  onReset,
  total,
  loading = false,
  className,
  compactMobile = false,
  mobileScope,
}: {
  filters?: ActiveListFilter[];
  onReset?: () => void;
  total?: number;
  loading?: boolean;
  className?: string;
  compactMobile?: boolean;
  mobileScope?: string;
}) {
  const t = useTranslations("workspace");
  return (
    <div
      data-filter-summary
      className={cn(
        "flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs",
        compactMobile && "max-md:flex-nowrap max-md:gap-2",
        className,
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-1.5",
          compactMobile && "max-md:flex-nowrap max-md:overflow-x-auto max-md:py-0.5",
        )}
      >
        {mobileScope ? (
          <span className="max-w-[10rem] shrink-0 truncate rounded-md bg-muted px-2 py-1 font-medium text-foreground md:hidden" title={mobileScope}>
            {mobileScope}
          </span>
        ) : null}
        {filters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={filter.onRemove}
            aria-label={t("removeFilter", { filter: filter.label })}
            title={compactMobile ? filter.label : undefined}
            className={cn(
              "inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2.5 text-left text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
              compactMobile && "max-md:max-w-[10rem] max-md:shrink-0",
            )}
          >
            <span className={cn("break-words", compactMobile && "max-md:truncate")}>{filter.label}</span>
            <CloseIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </button>
        ))}
        {filters.length && onReset ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            className={cn("h-8 px-2 text-xs", compactMobile && "max-md:shrink-0")}
          >
            {t("resetFilters")}
          </Button>
        ) : null}
        {!filters.length ? (
          <span className={cn("text-muted-foreground", compactMobile && "max-md:hidden")}>
            {t("filtersImmediate")}
          </span>
        ) : null}
      </div>
      <span
        role="status"
        aria-live="polite"
        className="shrink-0 tabular-nums text-muted-foreground"
      >
        {loading ? t("updating") : total === undefined ? null : t("resultCount", { count: total })}
      </span>
    </div>
  );
}
export function ListToolbar({
  children,
  extra,
  extraCount = 0,
  filters,
  onReset,
  total,
  loading,
  className,
  compactMobile,
}: {
  children: ReactNode;
  extra?: ReactNode;
  extraCount?: number;
  filters?: ActiveListFilter[];
  onReset?: () => void;
  total?: number;
  loading?: boolean;
  className?: string;
  compactMobile?: { search: ReactNode; scope?: string; extraCount: number };
}) {
  const t = useTranslations("workspace");
  const tCommon = useTranslations("common");
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const fieldsId = `${id}-fields`;
  const desktopFilterLabel =
    extraCount > 0 ? t("moreFiltersWithCount", { count: extraCount }) : t("moreFilters");
  const mobileFilterLabel = compactMobile?.extraCount
    ? t("moreFiltersWithCount", { count: compactMobile.extraCount })
    : tCommon("filters");
  return (
    <section
      data-list-toolbar
      aria-busy={loading || undefined}
      aria-label={t("searchAndFilters")}
      className={cn(
        "mb-4 min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4",
        compactMobile && "max-md:mb-3 max-md:border-0 max-md:bg-transparent max-md:p-0",
        className,
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-wrap items-end gap-3",
          compactMobile && "max-md:items-center max-md:gap-2",
        )}
      >
        {compactMobile ? (
          <>
            {compactMobile.search}
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-expanded={expanded}
              aria-controls={extra ? `${fieldsId} ${id}` : fieldsId}
              aria-label={mobileFilterLabel}
              onClick={() => setExpanded(!expanded)}
              className="relative h-11 w-11 md:hidden"
            >
              <AdjustIcon className="h-4 w-4" aria-hidden />
              {compactMobile.extraCount > 0 ? (
                <span aria-hidden className="absolute right-0.5 top-0.5 min-w-4 rounded bg-primary px-0.5 text-[10px] leading-4 text-primary-foreground">
                  {compactMobile.extraCount}
                </span>
              ) : null}
            </Button>
            <div
              id={fieldsId}
              className={cn(
                "md:contents",
                expanded
                  ? "max-md:flex max-md:min-w-0 max-md:basis-full max-md:flex-wrap max-md:items-end max-md:gap-3"
                  : "max-md:hidden",
              )}
            >
              {children}
            </div>
          </>
        ) : children}
        {extra ? (
          <Button
            type="button"
            variant="secondary"
            aria-expanded={expanded}
            aria-controls={id}
            aria-label={desktopFilterLabel}
            onClick={() => setExpanded(!expanded)}
            className={cn("ml-auto shrink-0", compactMobile && "max-md:hidden")}
          >
            <AdjustIcon className="h-4 w-4" aria-hidden />
            {t("moreFilters")}
            {extraCount > 0 ? (
              <span aria-hidden className="rounded bg-primary/10 px-1.5 text-primary">
                {extraCount}
              </span>
            ) : null}
            <ChevronDownIcon className={cn("h-3.5 w-3.5", expanded && "rotate-180")} aria-hidden />
          </Button>
        ) : null}
      </div>
      {extra ? (
        <div id={id} hidden={!expanded} className="mt-3 border-t border-border pt-3">
          <div className="flex min-w-0 flex-wrap items-end gap-3">{extra}</div>
        </div>
      ) : null}
      <FilterSummary
        filters={filters}
        onReset={onReset}
        total={total}
        loading={loading}
        className={cn("mt-3", compactMobile && "max-md:mt-2")}
        compactMobile={Boolean(compactMobile)}
        mobileScope={compactMobile?.scope}
      />
    </section>
  );
}
export function FilterField({
  label,
  id,
  children,
  className,
}: {
  label: string;
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 flex-1 basis-44", className)}>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
export function ListSearch({
  value,
  onChange,
  disabled,
  label,
  placeholder,
  className,
  id: providedId,
  dataTour,
  cameraScan,
  ...inputEvents
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label: string;
  placeholder?: string;
  className?: string;
  id?: string;
  dataTour?: string;
  cameraScan?: boolean;
} & Pick<
  ComponentProps<typeof SearchInput>,
  "onKeyDown" | "onBlur" | "onCompositionStart" | "onCompositionEnd" | "onScan"
>) {
  const generated = useId();
  const id = providedId ?? generated;
  return (
    <FilterField id={id} label={label} className={cn("basis-64", className)}>
      <SearchInput
        {...inputEvents}
        id={id}
        data-tour={dataTour}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        placeholder={placeholder}
        cameraScan={cameraScan}
      />
    </FilterField>
  );
}
