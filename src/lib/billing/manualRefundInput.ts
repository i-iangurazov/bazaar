import { businessDateKey } from "@/lib/timezone";

/** Exact KGS draft parsing. Never round a bank-transfer amount or accept grouping. */
export const parseManualRefundAmountMinor = (draft: string): number | null => {
  const value = draft.trim();
  if (value.length > 32 || !/^\d+(?:[.,]\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor > 0 && minor <= 2147483647 ? minor : null;
};

export const manualRefundBankOperationValid = (draft: string): boolean => {
  const value = draft.trim();
  const key = value.normalize("NFKC").replace(/\s+/gu, "").toUpperCase();
  return (
    value.length >= 3 &&
    value.length <= 120 &&
    key.length >= 3 &&
    key.length <= 120 &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  );
};

/** Bank dates are Bishkek calendar days, not browser-local timestamps. */
export const manualRefundBankDateValid = (
  value: string,
  paidAt: Date | string,
  now = new Date(),
): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  const paid = new Date(paidAt);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(paid.getTime())) return false;
  return (
    date.toISOString().slice(0, 10) === value &&
    value >= businessDateKey(paid) &&
    value <= businessDateKey(now)
  );
};
