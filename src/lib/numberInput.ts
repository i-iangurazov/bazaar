export const parseNumberInput = (rawValue: string) => {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

export const resolveNumberInputOnBlur = (rawValue: string, fallbackValue: number) => {
  const parsed = parseNumberInput(rawValue);
  return parsed ?? fallbackValue;
};

export const toNumberInputValue = (value: number | string | null | undefined) =>
  value === null || value === undefined ? "" : value;
