import { AppError } from "@/server/services/errors";

export const kgsToMinor = (amount: string | number) => {
  const value = String(amount);
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new AppError("billingInvalidAmount");
  const [whole, fraction = ""] = value.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > 2_147_483_647)
    throw new AppError("billingInvalidAmount");
  return minor;
};

export const minorToKgs = (minor: number) =>
  `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;

// Preserve the original billing day across February and other short months.
// UTC arithmetic is independent of the host/database timezone and DST.
export const extendSubscriptionMonth = (start: Date, anchorDay: number) => {
  const next = new Date(start);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(anchorDay, lastDay));
  return next;
};
