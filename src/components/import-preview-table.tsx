"use client";

import { useTranslations } from "next-intl";

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
    <div className="overflow-x-auto">
      <Table className="min-w-[520px]">
        <TableHeader>
          <TableRow>
            <TableHead>{t("fieldSku")}</TableHead>
            <TableHead>{t("fieldName")}</TableHead>
            <TableHead className="hidden sm:table-cell">{t("fieldCategory")}</TableHead>
            <TableHead className="hidden sm:table-cell">{t("fieldUnit")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {previewRows.map((row) => (
            <TableRow key={`${row.sku}-${row.name}`}>
              <TableCell className="text-xs text-gray-500">{row.sku}</TableCell>
              <TableCell className="font-medium">{row.name}</TableCell>
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
  );
};

export default ImportPreviewTable;
