"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowDownIcon, ArrowUpIcon } from "@/components/icons";

type ResponsiveDataListProps<T> = {
  items?: T[];
  renderDesktop: (items: T[]) => ReactNode;
  renderMobile: (item: T, index: number) => ReactNode;
  getKey?: (item: T, index: number) => string;
  empty?: ReactNode;
  desktopClassName?: string;
  mobileClassName?: string;
  paginationKey?: string;
  defaultPageSize?: number;
  pageSizeOptions?: number[];
  page?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
};

export const ResponsiveDataList = <T,>({
  items,
  renderDesktop,
  renderMobile,
  getKey,
  empty,
  desktopClassName,
  mobileClassName,
  paginationKey,
  defaultPageSize = 25,
  pageSizeOptions = [10, 25, 50, 100],
  page: externalPage,
  totalItems,
  onPageChange,
  onPageSizeChange,
}: ResponsiveDataListProps<T>) => {
  const tCommon = useTranslations("common");
  const list = useMemo(() => items ?? [], [items]);
  const isServerPagination =
    typeof onPageChange === "function" &&
    typeof onPageSizeChange === "function" &&
    typeof totalItems === "number";
  const storageKey = paginationKey ? `responsive-list:${paginationKey}:page-size` : null;
  const [internalPage, setInternalPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const page = isServerPagination ? Math.max(1, externalPage ?? 1) : internalPage;

  useEffect(() => {
    if (isServerPagination) {
      return;
    }
    if (!storageKey) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return;
      }
      const parsed = Number(raw);
      if (pageSizeOptions.includes(parsed)) {
        setPageSize(parsed);
      }
    } catch {
      // ignore storage errors
    }
  }, [isServerPagination, storageKey, pageSizeOptions]);

  useEffect(() => {
    if (isServerPagination) {
      onPageChange?.(1);
      return;
    }
    setInternalPage(1);
  }, [isServerPagination, onPageChange, pageSize]);

  const totalCount = isServerPagination ? totalItems : list.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  useEffect(() => {
    if (isServerPagination && totalCount === 0 && page > 1) {
      return;
    }
    if (page <= totalPages) {
      return;
    }
    if (isServerPagination) {
      onPageChange?.(totalPages);
      return;
    }
    setInternalPage(totalPages);
  }, [isServerPagination, onPageChange, page, totalCount, totalPages]);

  const pagedItems = useMemo(() => {
    if (isServerPagination) {
      return list;
    }
    const start = (page - 1) * pageSize;
    return list.slice(start, start + pageSize);
  }, [isServerPagination, list, page, pageSize]);
  const startItem = totalCount ? (page - 1) * pageSize + 1 : 0;
  const endItem = totalCount
    ? isServerPagination
      ? Math.min((page - 1) * pageSize + pagedItems.length, totalCount)
      : Math.min(page * pageSize, totalCount)
    : 0;
  const showPagination = totalPages > 1;

  return (
    <>
      <div className={cn("hidden md:block", desktopClassName)}>{renderDesktop(pagedItems)}</div>
      <div className={cn("md:hidden", mobileClassName)}>
        {pagedItems.length ? (
          <div className="space-y-3">
            {pagedItems.map((item, index) => {
              const itemIndex = (page - 1) * pageSize + index;
              return (
                <div key={getKey ? getKey(item, itemIndex) : String(itemIndex)}>
                  {renderMobile(item, itemIndex)}
                </div>
              );
            })}
          </div>
        ) : (
          empty ?? null
        )}
      </div>
      {showPagination ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
          <p className="text-xs text-muted-foreground">
            {tCommon("pagination.items", { from: startItem, to: endItem, total: totalCount })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{tCommon("pagination.rowsPerPage")}</span>
            <div className="w-[88px]">
              <Select
                value={String(pageSize)}
                onValueChange={(value) => {
                  const parsed = Number(value);
                  if (!pageSizeOptions.includes(parsed)) {
                    return;
                  }
                  setPageSize(parsed);
                  if (isServerPagination) {
                    onPageSizeChange?.(parsed);
                    return;
                  }
                  if (storageKey) {
                    try {
                      window.localStorage.setItem(storageKey, String(parsed));
                    } catch {
                      // ignore storage errors
                    }
                  }
                }}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageSizeOptions.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {tCommon("pagination.page", { page, totalPages })}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                if (isServerPagination) {
                  onPageChange?.(Math.max(1, page - 1));
                  return;
                }
                setInternalPage((prev) => Math.max(1, prev - 1));
              }}
              disabled={page <= 1}
              aria-label={tCommon("pagination.previous")}
              title={tCommon("pagination.previous")}
            >
              <ArrowUpIcon className="h-4 w-4 -rotate-90" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                if (isServerPagination) {
                  onPageChange?.(Math.min(totalPages, page + 1));
                  return;
                }
                setInternalPage((prev) => Math.min(totalPages, prev + 1));
              }}
              disabled={page >= totalPages}
              aria-label={tCommon("pagination.next")}
              title={tCommon("pagination.next")}
            >
              <ArrowDownIcon className="h-4 w-4 -rotate-90" aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
};
