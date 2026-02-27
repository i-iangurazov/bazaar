export type NormalizeScanOptions = {
  removeSpaces?: boolean;
  stripNonPrintable?: boolean;
};

const nonPrintablePattern = /[\u0000-\u001F\u007F-\u009F]/g;
const whitespacePattern = /\s+/g;

export const normalizeScanValue = (
  rawValue: string,
  options: NormalizeScanOptions = {},
): string => {
  const { removeSpaces = true, stripNonPrintable = true } = options;

  let normalized = `${rawValue ?? ""}`;

  if (stripNonPrintable) {
    normalized = normalized.replace(nonPrintablePattern, "");
  }

  normalized = normalized.trim();

  if (removeSpaces) {
    normalized = normalized.replace(whitespacePattern, "");
  }

  return normalized;
};
