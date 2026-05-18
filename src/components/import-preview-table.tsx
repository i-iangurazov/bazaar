"use client";

import { useTranslations } from "next-intl";

import { ResponsiveDataList } from "@/components/responsive-data-list";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ImportPreviewRow = {
  sku: string;
  name?: string;
  unit?: string;
  category?: string | null;
  basePriceKgs?: number;
  purchasePriceKgs?: number;
  avgCostKgs?: number;
  minStock?: number;
};

type ImportPreviewTableProps = {
  rows: ImportPreviewRow[];
  limit?: number;
};

const ImportPreviewTable = ({ rows, limit = 5 }: ImportPreviewTableProps) => {
  const t = useTranslations("imports");
  const tCommon = useTranslations("common");
  const previewRows = rows.slice(0, limit);

  return (
    <ResponsiveDataList
      items={previewRows}
      getKey={(row) => `${row.sku}-${row.name ?? ""}`}
      renderDesktop={(visibleItems) => (
        <div className="overflow-x-auto">
          <Table className="min-w-[520px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("fieldSku")}</TableHead>
                <TableHead>{t("fieldName")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("fieldBasePrice")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("fieldPurchasePrice")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("fieldAvgCost")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("fieldMinStock")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("fieldCategory")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("fieldUnit")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleItems.map((row) => (
                <TableRow key={`${row.sku}-${row.name ?? ""}`}>
                  <TableCell className="text-xs text-muted-foreground">{row.sku}</TableCell>
                  <TableCell className="font-medium">{row.name ?? tCommon("notAvailable")}</TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">
                    {row.basePriceKgs ?? tCommon("notAvailable")}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">
                    {row.purchasePriceKgs ?? tCommon("notAvailable")}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">
                    {row.avgCostKgs ?? tCommon("notAvailable")}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">
                    {row.minStock ?? tCommon("notAvailable")}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                    {row.category ?? tCommon("notAvailable")}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                    {row.unit ?? tCommon("notAvailable")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      renderMobile={(row) => (
        <div className="rounded-md border border-border bg-card p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{row.name ?? tCommon("notAvailable")}</p>
            <p className="text-xs text-muted-foreground">{row.sku}</p>
          </div>
          <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                {t("fieldCategory")}
              </p>
              <p className="text-foreground/90">{row.category ?? tCommon("notAvailable")}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                {t("fieldUnit")}
              </p>
              <p className="text-foreground/90">{row.unit ?? tCommon("notAvailable")}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                {t("fieldBasePrice")}
              </p>
              <p className="text-foreground/90">{row.basePriceKgs ?? tCommon("notAvailable")}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                {t("fieldPurchasePrice")}
              </p>
              <p className="text-foreground/90">{row.purchasePriceKgs ?? tCommon("notAvailable")}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                {t("fieldAvgCost")}
              </p>
              <p className="text-foreground/90">{row.avgCostKgs ?? tCommon("notAvailable")}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                {t("fieldMinStock")}
              </p>
              <p className="text-foreground/90">{row.minStock ?? tCommon("notAvailable")}</p>
            </div>
          </div>
        </div>
      )}
    />
  );
};

export default ImportPreviewTable;
