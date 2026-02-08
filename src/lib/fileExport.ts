import * as XLSX from "xlsx";

export type DownloadFormat = "csv" | "xlsx";

const escapeCsvValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, "\"\"")}"`;
  }
  return str;
};

const triggerDownload = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const buildCsv = (rows: string[][]) => {
  const lines = rows.map((row) => row.map((value) => escapeCsvValue(value)).join(","));
  return `\ufeff${lines.join("\r\n")}`;
};

const buildXlsx = (rows: string[][]) => {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, "export");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};

const ensureRows = (header: string[], rows: string[][]) => [header, ...rows];

export const downloadTableFile = (input: {
  format: DownloadFormat;
  fileNameBase: string;
  header: string[];
  rows: string[][];
}) => {
  const allRows = ensureRows(input.header, input.rows);
  if (input.format === "xlsx") {
    const content = buildXlsx(allRows);
    triggerDownload(
      new Blob([content], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      `${input.fileNameBase}.xlsx`,
    );
    return;
  }

  const content = buildCsv(allRows);
  triggerDownload(new Blob([content], { type: "text/csv;charset=utf-8" }), `${input.fileNameBase}.csv`);
};

export const parseCsvTextRows = (csv: string) => {
  const workbook = XLSX.read(csv, { type: "string", raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    blankrows: false,
  });
  return rows.map((row) => row.map((cell) => String(cell ?? "")));
};
