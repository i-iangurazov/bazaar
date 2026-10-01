import { Prisma } from "@prisma/client";

const gcd = (a: bigint, b: bigint): bigint => b === 0n ? a : gcd(b, a % b);

/** Floor once, after exact rational allocation. Repeating fractions cannot lose a point. */
export function cumulativeReturnPoints(postedPoints: number, lines: Array<{ weightKgs: string; qty: number; returnedQty: number }>) {
  let numerator = 0n, denominator = 1n, fullWeight = 0n;
  for (const line of lines) {
    const weight = BigInt(new Prisma.Decimal(line.weightKgs).mul(100).toFixed(0));
    const qty = BigInt(line.qty);
    if (weight <= 0n || qty <= 0n) continue;
    fullWeight += weight;
    const returned = BigInt(Math.max(0, Math.min(line.qty, line.returnedQty)));
    numerator = numerator * qty + weight * returned * denominator;
    denominator *= qty;
    const divisor = gcd(numerator, denominator);
    numerator /= divisor; denominator /= divisor;
  }
  if (fullWeight === 0n || postedPoints <= 0) return 0;
  return Number(BigInt(postedPoints) * numerator / (fullWeight * denominator));
}
