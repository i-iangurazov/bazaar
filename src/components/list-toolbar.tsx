"use client";
import { type ReactNode, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { SearchIcon, CloseIcon, AdjustIcon, ChevronDownIcon } from "@/components/icons";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
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
}: {
  filters?: ActiveListFilter[];
  onReset?: () => void;
  total?: number;
  loading?: boolean;
  className?: string;
}) {
  const t = useTranslations("workspace");
  return (
    <div
      data-filter-summary
      className={cn(
        "flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {filters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={filter.onRemove}
            aria-label={t("removeFilter", { filter: filter.label })}
            className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2.5 text-left text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="break-words">{filter.label}</span>
            <CloseIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </button>
        ))}
        {filters.length && onReset ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-8 px-2 text-xs"
          >
            {t("resetFilters")}
          </Button>
        ) : null}
        {!filters.length ? (
          <span className="text-muted-foreground">{t("filtersImmediate")}</span>
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
}: {
  children: ReactNode;
  extra?: ReactNode;
  extraCount?: number;
  filters?: ActiveListFilter[];
  onReset?: () => void;
  total?: number;
  loading?: boolean;
  className?: string;
}) {
  const t = useTranslations("workspace");
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <section
      data-list-toolbar
      aria-busy={loading || undefined}
      aria-label={t("searchAndFilters")}
      className={cn("mb-4 min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4", className)}
    >
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        {children}
        {extra ? (
          <Button
            type="button"
            variant="secondary"
            aria-expanded={expanded}
            aria-controls={id}
            onClick={() => setExpanded(!expanded)}
            className="ml-auto shrink-0"
          >
            <AdjustIcon className="h-4 w-4" aria-hidden />
            {t("moreFilters")}
            {extraCount > 0 ? (
              <span className="rounded bg-primary/10 px-1.5 text-primary">{extraCount}</span>
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
        className="mt-3"
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
  label,
  placeholder,
  className,
  id: providedId,
  dataTour,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
  id?: string;
  dataTour?: string;
}) {
  const generated = useId();
  const id = providedId ?? generated;
  const t = useTranslations("workspace");
  return (
    <FilterField id={id} label={label} className={cn("basis-64", className)}>
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={id}
          data-tour={dataTour}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {value ? (
          <button
            type="button"
            aria-label={t("clearSearch")}
            onClick={() => onChange("")}
            className="absolute right-0 top-0 flex h-10 w-9 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <CloseIcon className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </FilterField>
  );
}
