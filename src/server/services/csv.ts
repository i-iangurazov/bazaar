const escapeValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (/[\",\n]/.test(str)) {
    return `"${str.replace(/\"/g, "\"\"")}"`;
  }
  return str;
};

export const toCsv = (header: string[], rows: Array<Record<string, unknown>>, keys: string[]) => {
  const lines = [
    header.map(escapeValue).join(","),
    ...rows.map((row) => keys.map((key) => escapeValue(row[key])).join(",")),
  ];
  return lines.join("\n");
};
