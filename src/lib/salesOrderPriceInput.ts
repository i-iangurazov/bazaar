import { displayMoneyFromKgs, resolveCurrency, type CurrencySource } from "@/lib/currencyDisplay";
import { parsePriceInput } from "@/lib/priceInput";

export const salesOrderPriceInput = (amountKgs: number, currency: CurrencySource) =>
  String(Number(displayMoneyFromKgs(amountKgs, currency).toFixed(2)));

export const salesOrderLineTotal = (qty: number, unitPriceKgs: number | null) => {
  if (unitPriceKgs === null || !Number.isFinite(qty) || qty <= 0) return null;
  const cents = BigInt(unitPriceKgs.toFixed(2).replace(".", ""));
  const thousandths = BigInt(qty.toFixed(3).replace(".", ""));
  return Number((cents * thousandths + 500n) / 1000n) / 100;
};

/** Only edited document prices are converted; untouched snapshots stay on the server. */
export const parseSalesOrderPriceInput = (value: string, currency: CurrencySource) => {
  const amount = parsePriceInput(value);
  if (amount === null || amount < 0) return null;
  if (amount === 0) return 0;
  const { currencyCode, currencyRateKgsPerUnit } = resolveCurrency(currency);
  const [whole, fraction = ""] = value.trim().replace(/^\+/, "").replace(",", ".").split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  // Snapshots have six decimal places. Integer arithmetic avoids turning
  // 2.01 × 87.5 into 175.87 through binary floating-point rounding.
  const rate = currencyCode === "KGS" ? 1 : currencyRateKgsPerUnit;
  if (rate >= 1e21) return null;
  const rateUnits = BigInt(rate.toFixed(6).replace(".", ""));
  const kgsCents = (cents * rateUnits + 500_000n) / 1_000_000n;
  return kgsCents <= 999_999_999_999n ? Number(kgsCents) / 100 : null;
};
