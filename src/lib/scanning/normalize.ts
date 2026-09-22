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

// UPC-A and zero-prefixed EAN-13 encode the same bars. Never coerce to a number.
export const equivalentRetailBarcode = (value: string): string | null => {
  if (!/^(?:[0-9]{12}|0[0-9]{12})$/.test(value)) return null;
  const ean = value.length === 12 ? `0${value}` : value;
  const sum = [...ean.slice(0, 12)].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1),
    0,
  );
  if ((10 - (sum % 10)) % 10 !== Number(ean[12])) return null;
  return value.length === 12 ? ean : value.slice(1);
};
