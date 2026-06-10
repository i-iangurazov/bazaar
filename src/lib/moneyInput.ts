export const parseMoneyInput = (raw: string) => {
  const compact = raw.replace(/[\s\u00a0\u202f]+/g, "").replace(/[^\d.,-]/g, "");
  if (!compact || compact.includes("-")) {
    return null;
  }

  const separators = [...compact.matchAll(/[.,]/g)].map((match) => ({
    value: match[0],
    index: match.index ?? -1,
  }));

  if (!separators.length) {
    const amount = Number(compact);
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
  }

  const lastSeparator = separators[separators.length - 1];
  const integerPart = compact.slice(0, lastSeparator.index);
  const fractionPart = compact.slice(lastSeparator.index + 1);
  const integerDigits = integerPart.replace(/[.,]/g, "");
  const hasMixedSeparators = separators.some((separator) => separator.value !== lastSeparator.value);
  const hasRepeatedSameSeparator = separators.length > 1 && !hasMixedSeparators;
  const onlySeparatorLooksDecimal =
    separators.length === 1 && fractionPart.length === 3 && integerDigits.length > 3;
  const lastSeparatorLooksDecimal =
    fractionPart.length > 0 &&
    (fractionPart.length <= 2 || onlySeparatorLooksDecimal) &&
    (hasMixedSeparators || !hasRepeatedSameSeparator);

  const normalized = lastSeparatorLooksDecimal
    ? `${integerPart.replace(/[.,]/g, "")}.${fractionPart.replace(/[.,]/g, "")}`
    : compact.replace(/[.,]/g, "");
  const amount = Number(normalized);

  return Number.isFinite(amount) && amount >= 0 ? amount : null;
};

export const moneyToMinorUnits = (amount: number) => {
  if (!Number.isFinite(amount)) {
    return null;
  }
  return Math.round((amount + 1e-9) * 100);
};

export const minorUnitsToMoney = (minorUnits: number) => minorUnits / 100;

export const moneyInputsEqual = (left: string, right: string) => {
  const leftAmount = parseMoneyInput(left);
  const rightAmount = parseMoneyInput(right);
  if (leftAmount === null || rightAmount === null) {
    return false;
  }
  return moneyToMinorUnits(leftAmount) === moneyToMinorUnits(rightAmount);
};
