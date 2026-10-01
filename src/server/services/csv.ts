const spreadsheetFormulaPattern = /^[\s\u0000-\u001f]*[=+\-@]/;
const csvDelimiter = ";";

export const sanitizeSpreadsheetValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const str = String(value);
  if (!str) {
    return str;
  }
  if (spreadsheetFormulaPattern.test(str)) {
    return `'${str}`;
  }
  return str;
};

const escapeValue = (value: unknown) => {
  const str = sanitizeSpreadsheetValue(value);
  if (str.includes(csvDelimiter) || /[\"\r\n]/.test(str)) {
    return `"${str.replace(/\"/g, "\"\"")}"`;
  }
  return str;
};

export const toCsv = (header: string[], rows: Array<Record<string, unknown>>, keys: string[]) => {
  const lines = [
    header.map(escapeValue).join(csvDelimiter),
    ...rows.map((row) => keys.map((key) => escapeValue(row[key])).join(csvDelimiter)),
  ];
  const bom = "\ufeff";
  return `${bom}${lines.join("\r\n")}`;
};
