"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type Row,
  type SortingState,
} from "@tanstack/react-table";

import { ArrowDownIcon, ArrowUpIcon, EmptyIcon, SortIcon } from "@/components/icons";
import {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type ColumnMeta = {
  className?: string;
  headerClassName?: string;
  cellClassName?: string;
};

export type DataTablePaginationLabels = {
  items: (from: number, to: number, total: number) => React.ReactNode;
  rowsPerPage: React.ReactNode;
  page: (page: number, totalPages: number) => React.ReactNode;
  previous: string;
  next: string;
};

export type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  getRowId?: (row: TData, index: number) => string;
  isLoading?: boolean;
  empty?: React.ReactNode;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  manualSorting?: boolean;
  className?: string;
  tableClassName?: string;
  rowClassName?: (row: Row<TData>) => string | undefined;
  rowTestId?: string | ((row: Row<TData>) => string | undefined);
  stickyHeader?: boolean;
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
    pageSizeOptions?: number[];
    labels: DataTablePaginationLabels;
  };
};

const getColumnMeta = (column: unknown): ColumnMeta => {
  const columnDef = column as { columnDef?: { meta?: ColumnMeta } };
  return columnDef.columnDef?.meta ?? {};
};

export const DataTable = <TData, TValue>({
  columns,
  data,
  getRowId,
  isLoading = false,
  empty,
  sorting,
  onSortingChange,
  manualSorting = false,
  className,
  tableClassName,
  rowClassName,
  rowTestId,
  stickyHeader = false,
  pagination,
}: DataTableProps<TData, TValue>) => {
  const [internalSorting, setInternalSorting] = React.useState<SortingState>([]);
  const resolvedSorting = sorting ?? internalSorting;
  const table = useReactTable({
    data,
    columns,
    state: { sorting: resolvedSorting },
    onSortingChange: onSortingChange ?? setInternalSorting,
    manualSorting,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const totalItems = pagination?.totalItems ?? data.length;
  const totalPages = pagination ? Math.max(1, Math.ceil(totalItems / pagination.pageSize)) : 1;
  const startItem = pagination && totalItems ? (pagination.page - 1) * pagination.pageSize + 1 : 0;
  const endItem =
    pagination && totalItems
      ? Math.min((pagination.page - 1) * pagination.pageSize + data.length, totalItems)
      : data.length;

  return (
    <div className={cn("min-w-0", className)} data-component="data-table">
      <div className="w-full overflow-x-auto rounded-xl border border-border/65 bg-card/95 shadow-[0_14px_36px_rgba(15,23,42,0.045)] ring-1 ring-foreground/[0.012] dark:shadow-none">
        <table className={cn("w-full caption-bottom text-sm", tableClassName)}>
          <thead
            className={cn(
              "bg-muted/55 text-muted-foreground [&_tr]:border-b [&_tr]:border-border/70",
              stickyHeader && "sticky top-0 z-10",
            )}
          >
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const meta = getColumnMeta(header.column);
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  const ariaSort = canSort
                    ? sorted === "asc"
                      ? "ascending"
                      : sorted === "desc"
                        ? "descending"
                        : "none"
                    : undefined;
                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      aria-sort={ariaSort}
                      className={cn(
                        "h-12 px-3 text-left align-middle text-[11px] font-bold uppercase tracking-[0.075em] text-muted-foreground",
                        meta.className,
                        meta.headerClassName,
                      )}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className={cn(
                            "inline-flex max-w-full items-center gap-1.5 text-left uppercase text-inherit",
                            meta.headerClassName?.includes("text-right") ||
                              meta.className?.includes("text-right")
                              ? "ml-auto"
                              : undefined,
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <span className="truncate">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </span>
                          {sorted === "asc" ? (
                            <ArrowUpIcon
                              className="h-3.5 w-3.5 shrink-0 text-foreground"
                              aria-hidden
                            />
                          ) : sorted === "desc" ? (
                            <ArrowDownIcon
                              className="h-3.5 w-3.5 shrink-0 text-foreground"
                              aria-hidden
                            />
                          ) : (
                            <SortIcon
                              className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                              aria-hidden
                            />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading && !rows.length ? (
              Array.from({ length: 5 }).map((_, rowIndex) => (
                <tr key={`loading-${rowIndex}`} className="border-b border-border/55 last:border-b-0">
                  {table.getAllLeafColumns().map((column) => {
                    const meta = getColumnMeta(column);
                    return (
                      <td key={column.id} className={cn("px-3 py-4 align-middle", meta.className)}>
                        <Skeleton className="h-4 w-full max-w-[12rem]" />
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : rows.length ? (
              rows.map((row) => (
                <tr
                  key={row.id}
                  data-testid={typeof rowTestId === "function" ? rowTestId(row) : rowTestId}
                  className={cn(
                    "border-b border-border/55 transition-colors last:border-b-0 hover:bg-primary/[0.045]",
                    rowClassName?.(row),
                  )}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = getColumnMeta(cell.column);
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          "px-3 py-4 align-middle text-sm text-foreground",
                          meta.className,
                          meta.cellClassName,
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={table.getAllLeafColumns().length} className="p-0">
                  {empty ?? (
                    <div className="flex min-h-[12rem] flex-col items-center justify-center p-6 text-center text-sm text-muted-foreground">
                      <EmptyIcon className="mb-3 h-8 w-8" aria-hidden />
                      No results
                    </div>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pagination && totalPages > 1 ? (
        <Pagination className="mt-4 flex-wrap border-t border-border/70 pt-3">
          <p className="text-xs text-muted-foreground">
            {pagination.labels.items(startItem, endItem, totalItems)}
          </p>
          <PaginationContent>
            <PaginationItem>
              <span className="text-xs text-muted-foreground">{pagination.labels.rowsPerPage}</span>
            </PaginationItem>
            <PaginationItem>
              <div className="w-[96px] sm:w-[88px]">
                <Select
                  value={String(pagination.pageSize)}
                  onValueChange={(value) => {
                    const parsed = Number(value);
                    if (!Number.isFinite(parsed)) {
                      return;
                    }
                    pagination.onPageSizeChange(parsed);
                  }}
                >
                  <SelectTrigger className="h-10 sm:h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(pagination.pageSizeOptions ?? [10, 25, 50, 100]).map((option) => (
                      <SelectItem key={option} value={String(option)}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </PaginationItem>
            <PaginationItem>
              <p className="text-xs text-muted-foreground">
                {pagination.labels.page(pagination.page, totalPages)}
              </p>
            </PaginationItem>
            <PaginationItem>
              <PaginationButton
                type="button"
                onClick={() => pagination.onPageChange(Math.max(1, pagination.page - 1))}
                disabled={pagination.page <= 1}
                aria-label={pagination.labels.previous}
                title={pagination.labels.previous}
              >
                <ArrowUpIcon className="h-4 w-4 -rotate-90" aria-hidden />
              </PaginationButton>
            </PaginationItem>
            <PaginationItem>
              <PaginationButton
                type="button"
                onClick={() => pagination.onPageChange(Math.min(totalPages, pagination.page + 1))}
                disabled={pagination.page >= totalPages}
                aria-label={pagination.labels.next}
                title={pagination.labels.next}
              >
                <ArrowDownIcon className="h-4 w-4 -rotate-90" aria-hidden />
              </PaginationButton>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  );
};
