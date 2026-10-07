export const quantityPrecision = 3;
export const maximumQuantity = Number.MAX_SAFE_INTEGER / 1000;

/** Physical quantities are fixed to thousandths; money has its own rounding. */
export function roundQuantity(value: number): number {
  return Number(value.toFixed(quantityPrecision));
}

export function isValidQuantity(value: number, precision = quantityPrecision): boolean {
  if (!Number.isFinite(value) || Math.abs(value) > maximumQuantity) return false;
  return value === Number(value.toFixed(precision));
}

export function parseQuantity(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return isValidQuantity(number) ? number : null;
}

export function defaultUnitPrecision(code: string, label?: string): 0 | 3 {
  const measured = new Set([
    "kg",
    "g",
    "l",
    "m",
    "кг",
    "г",
    "л",
    "м",
    "kilogram",
    "gram",
    "liter",
    "litre",
    "meter",
    "metre",
    "килограмм",
    "грамм",
    "литр",
    "метр",
  ]);
  return measured.has(code.trim().toLowerCase()) || measured.has(label?.trim().toLowerCase() ?? "")
    ? 3
    : 0;
}
