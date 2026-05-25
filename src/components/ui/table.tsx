"use client";

import * as React from "react";

import { ArrowDownIcon, ArrowUpIcon, SortIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

type TableSortDirection = "asc" | "desc";
type TableSortState = {
  columnIndex: number;
  direction: TableSortDirection;
} | null;

type SortableTableContextValue = {
  enabled: boolean;
  sortState: TableSortState;
  setSortState: React.Dispatch<React.SetStateAction<TableSortState>>;
};

type PrimitiveSortValue = string | number | boolean;
type TableProps = React.TableHTMLAttributes<HTMLTableElement> & {
  sortable?: boolean;
};
type TableHeadProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
  sortable?: boolean;
};

const SortableTableContext = React.createContext<SortableTableContextValue | null>(null);
const sortCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const isPrimitiveSortValue = (value: unknown): value is PrimitiveSortValue =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

const normalizeNumericText = (value: string) => {
  const compact = value.replace(/\u00a0/g, " ").trim();
  if (!compact || !/^[+\-]?(?:[\d\s.,'’₽$€£¥₸₴])/.test(compact)) {
    return null;
  }

  const candidate = compact
    .replace(/\s+/g, "")
    .replace(/[₽$€£¥₸₴%]/g, "")
    .replace(/(?:сом|kgs?|kg|шт|pcs?|ед\.?)/gi, "")
    .replace(/['’]/g, "");

  if (!/^[+\-]?\d[\d.,]*$/.test(candidate)) {
    return null;
  }

  const lastComma = candidate.lastIndexOf(",");
  const lastDot = candidate.lastIndexOf(".");
  let normalized = candidate;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = candidate
      .replace(new RegExp(`\\${thousandsSeparator}`, "g"), "")
      .replace(decimalSeparator, ".");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? "," : ".";
    const separatorIndex = lastComma >= 0 ? lastComma : lastDot;
    const trailing = candidate.slice(separatorIndex + 1);
    const integer = candidate.slice(0, separatorIndex).replace(/^[+\-]/, "");
    normalized =
      trailing.length === 3 && integer.length > 0
        ? candidate.replace(new RegExp(`\\${separator}`, "g"), "")
        : candidate.replace(separator, ".");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeDateText = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const dayMonthYear = trimmed.match(
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:,?\s+(\d{1,2}):(\d{2}))?/,
  );
  if (dayMonthYear) {
    const [, day, month, year, hour = "0", minute = "0"] = dayMonthYear;
    const fullYear = year.length === 2 ? `20${year}` : year;
    const parsed = new Date(
      Number(fullYear),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
    ).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (!/\d{4}-\d{1,2}-\d{1,2}|[A-Za-z]{3,}/.test(trimmed)) {
    return null;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const extractSortableText = (node: React.ReactNode): string => {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractSortableText).filter(Boolean).join(" ");
  }
  if (!React.isValidElement(node)) {
    return "";
  }

  const props = node.props as Record<string, unknown>;
  const explicitSortValue = props["data-sort-value"];
  if (isPrimitiveSortValue(explicitSortValue)) {
    return String(explicitSortValue);
  }

  const childText = extractSortableText(props.children as React.ReactNode);
  if (childText) {
    return childText;
  }

  const value = props.value;
  if (isPrimitiveSortValue(value)) {
    return String(value);
  }

  const title = props.title;
  if (isPrimitiveSortValue(title)) {
    return String(title);
  }

  const ariaLabel = props["aria-label"];
  return isPrimitiveSortValue(ariaLabel) ? String(ariaLabel) : "";
};

const containsInteractiveElement = (node: React.ReactNode): boolean => {
  if (node === null || node === undefined || typeof node === "boolean") {
    return false;
  }
  if (Array.isArray(node)) {
    return node.some(containsInteractiveElement);
  }
  if (!React.isValidElement(node)) {
    return false;
  }

  const type = node.type;
  const props = node.props as Record<string, unknown>;
  if (typeof type === "string" && ["a", "button", "input", "select", "textarea"].includes(type)) {
    return true;
  }
  if (typeof props.onClick === "function" || props.role === "button") {
    return true;
  }
  return containsInteractiveElement(props.children as React.ReactNode);
};

const getColumnIndex = (props: Record<string, unknown>) => {
  const value = props["data-column-index"];
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
};

const getRowCellSortText = (row: React.ReactNode, columnIndex: number) => {
  if (!React.isValidElement(row)) {
    return "";
  }
  if (row.type === React.Fragment) {
    const firstRow = React.Children.toArray(
      (row.props as { children?: React.ReactNode }).children,
    ).find(React.isValidElement);
    return getRowCellSortText(firstRow, columnIndex);
  }

  const cells = React.Children.toArray(
    (row.props as { children?: React.ReactNode }).children,
  ).filter(React.isValidElement);
  const cell = cells[columnIndex];
  if (!React.isValidElement(cell)) {
    return "";
  }

  const props = cell.props as Record<string, unknown>;
  const explicitSortValue = props["data-sort-value"];
  if (isPrimitiveSortValue(explicitSortValue)) {
    return String(explicitSortValue);
  }
  return extractSortableText(props.children as React.ReactNode);
};

const compareSortText = (left: string, right: string) => {
  const leftNumber = normalizeNumericText(left);
  const rightNumber = normalizeNumericText(right);
  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber;
  }

  const leftDate = normalizeDateText(left);
  const rightDate = normalizeDateText(right);
  if (leftDate !== null && rightDate !== null) {
    return leftDate - rightDate;
  }

  return sortCollator.compare(left.trim(), right.trim());
};

export const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, sortable = true, ...props }, ref) => {
    const [sortState, setSortState] = React.useState<TableSortState>(null);
    const dataSortable = (props as Record<string, unknown>)["data-sortable"];
    const enabled = sortable !== false && dataSortable !== false && dataSortable !== "false";
    const contextValue = React.useMemo(
      () => ({ enabled, sortState, setSortState }),
      [enabled, sortState],
    );

    return (
      <SortableTableContext.Provider value={contextValue}>
        <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
      </SortableTableContext.Provider>
    );
  },
);
Table.displayName = "Table";

export const TableContainer = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("w-full overflow-x-auto rounded-md border border-border bg-card", className)}
    {...props}
  />
));
TableContainer.displayName = "TableContainer";

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b [&_tr]:border-border", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, children, ...props }, ref) => {
  const sortableTable = React.useContext(SortableTableContext);
  const sortedChildren = React.useMemo(() => {
    if (!sortableTable?.enabled || !sortableTable.sortState) {
      return children;
    }

    const { columnIndex, direction } = sortableTable.sortState;
    const multiplier = direction === "asc" ? 1 : -1;
    return React.Children.toArray(children)
      .map((child, index) => ({ child, index }))
      .sort((left, right) => {
        const result = compareSortText(
          getRowCellSortText(left.child, columnIndex),
          getRowCellSortText(right.child, columnIndex),
        );
        return result === 0 ? left.index - right.index : result * multiplier;
      })
      .map(({ child }) => child);
  }, [children, sortableTable?.enabled, sortableTable?.sortState]);

  return (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props}>
      {sortedChildren}
    </tbody>
  );
});
TableBody.displayName = "TableBody";

export const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t border-border bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className,
    )}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, children, ...props }, ref) => {
  const childrenWithColumnIndexes = React.useMemo(() => {
    let columnIndex = 0;
    return React.Children.map(children, (child) => {
      if (!React.isValidElement(child)) {
        return child;
      }

      const childProps = child.props as Record<string, unknown>;
      const nextColumnIndex = childProps["data-column-index"] ?? columnIndex;
      columnIndex += 1;
      return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
        "data-column-index": nextColumnIndex,
      });
    });
  }, [children]);

  return (
    <tr ref={ref} className={cn("border-b border-border transition-colors", className)} {...props}>
      {childrenWithColumnIndexes}
    </tr>
  );
});
TableRow.displayName = "TableRow";

export const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, children, onClick, sortable = true, ...props }, ref) => {
    const sortableTable = React.useContext(SortableTableContext);
    const columnIndex = getColumnIndex(props as Record<string, unknown>);
    const sortableColumnIndex = columnIndex ?? -1;
    const isActive = sortableTable?.sortState?.columnIndex === columnIndex;
    const isSortable =
      Boolean(sortableTable?.enabled) &&
      sortable !== false &&
      typeof onClick !== "function" &&
      columnIndex !== null &&
      extractSortableText(children).trim().length > 0 &&
      !containsInteractiveElement(children);
    const ariaSort =
      props["aria-sort"] ??
      (isSortable
        ? isActive
          ? sortableTable?.sortState?.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
        : undefined);

    return (
      <th
        ref={ref}
        className={cn(
          "h-12 px-3 text-left align-middle text-xs font-semibold uppercase text-muted-foreground",
          className,
        )}
        onClick={onClick}
        {...props}
        aria-sort={ariaSort}
      >
        {isSortable ? (
          <button
            type="button"
            className="inline-flex max-w-full items-center gap-1.5 text-left uppercase text-inherit"
            onClick={() =>
              sortableTable?.setSortState((current) =>
                current?.columnIndex === sortableColumnIndex
                  ? {
                      columnIndex: sortableColumnIndex,
                      direction: current.direction === "asc" ? "desc" : "asc",
                    }
                  : { columnIndex: sortableColumnIndex, direction: "asc" },
              )
            }
          >
            <span className="truncate">{children}</span>
            {isActive ? (
              sortableTable?.sortState?.direction === "asc" ? (
                <ArrowUpIcon className="h-3.5 w-3.5 shrink-0 text-foreground" aria-hidden />
              ) : (
                <ArrowDownIcon className="h-3.5 w-3.5 shrink-0 text-foreground" aria-hidden />
              )
            ) : (
              <SortIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
            )}
          </button>
        ) : (
          children
        )}
      </th>
    );
  },
);
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn("px-3 py-3 align-middle", className)} {...props} />
));
TableCell.displayName = "TableCell";

export const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-4 text-xs text-muted-foreground", className)} {...props} />
));
TableCaption.displayName = "TableCaption";
