import * as XLSX from "xlsx";

export type DownloadFormat = "csv" | "xlsx";

const csvDelimiter = ";";

const escapeCsvValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "";
  }
  const str = sanitizeSpreadsheetValue(value);
  if (str.includes(csvDelimiter) || /["\r\n]/.test(str)) {
    return `"${str.replace(/"/g, "\"\"")}"`;
  }
  return str;
};

const spreadsheetFormulaPattern = /^[=+\-@]/;

export const sanitizeSpreadsheetValue = (value: unknown) => {
  const str = String(value ?? "");
  if (!str) {
    return str;
  }
  if (spreadsheetFormulaPattern.test(str)) {
    return `'${str}`;
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
  const lines = rows.map((row) => row.map((value) => escapeCsvValue(value)).join(csvDelimiter));
  return `\ufeff${lines.join("\r\n")}`;
};

const buildXlsx = (rows: string[][]) => {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(
    rows.map((row) => row.map((value) => sanitizeSpreadsheetValue(value))),
  );
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
  const text = csv.replace(/^\ufeff/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const countOutsideQuotes = (delimiter: string) => {
    let count = 0;
    let inQuotes = false;
    for (let index = 0; index < firstLine.length; index += 1) {
      const char = firstLine[index];
      if (char === '"') {
        if (inQuotes && firstLine[index + 1] === '"') {
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (!inQuotes && char === delimiter) {
        count += 1;
      }
    }
    return count;
  };
  const delimiter = countOutsideQuotes(";") >= countOutsideQuotes(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && char === delimiter) {
      row.push(value);
      value = "";
    } else if (!inQuotes && (char === "\n" || char === "\r")) {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.length > 0));
};
