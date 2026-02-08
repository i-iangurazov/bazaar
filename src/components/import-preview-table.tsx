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
  name: string;
  unit: string;
  category?: string | null;
  basePriceKgs?: number;
  purchasePriceKgs?: number;
  avgCostKgs?: number;
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
      getKey={(row) => `${row.sku}-${row.name}`}
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
                <TableHead className="hidden sm:table-cell">{t("fieldCategory")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("fieldUnit")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleItems.map((row) => (
                <TableRow key={`${row.sku}-${row.name}`}>
                  <TableCell className="text-xs text-gray-500">{row.sku}</TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-xs text-gray-500 hidden lg:table-cell">
                    {row.basePriceKgs ?? tCommon("notAvailable")}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500 hidden lg:table-cell">
                    {row.purchasePriceKgs ?? tCommon("notAvailable")}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500 hidden lg:table-cell">
                    {row.avgCostKgs ?? tCommon("notAvailable")}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500 hidden sm:table-cell">
                    {row.category ?? tCommon("notAvailable")}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500 hidden sm:table-cell">
                    {row.unit}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      renderMobile={(row) => (
        <div className="rounded-md border border-gray-200 bg-white p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{row.name}</p>
            <p className="text-xs text-gray-500">{row.sku}</p>
          </div>
          <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400">
                {t("fieldCategory")}
              </p>
              <p className="text-gray-700">{row.category ?? tCommon("notAvailable")}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400">
                {t("fieldUnit")}
              </p>
              <p className="text-gray-700">{row.unit}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400">
                {t("fieldBasePrice")}
              </p>
              <p className="text-gray-700">{row.basePriceKgs ?? tCommon("notAvailable")}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400">
                {t("fieldPurchasePrice")}
              </p>
              <p className="text-gray-700">{row.purchasePriceKgs ?? tCommon("notAvailable")}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400">
                {t("fieldAvgCost")}
              </p>
              <p className="text-gray-700">{row.avgCostKgs ?? tCommon("notAvailable")}</p>
            </div>
          </div>
        </div>
      )}
    />
  );
};

export default ImportPreviewTable;
