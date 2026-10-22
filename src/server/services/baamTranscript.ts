// Normalize spoken punctuation only for an exact, unambiguous SKU already in
// the authorized catalog. Never fuzzily replace a different product or number.
export function normalizeBaamTranscript(text: string, skus: string[]) {
  const spokenNumbers: Record<string, string[]> = {
    "0": ["ноль", "zero", "нөл"],
    "1": ["один", "одна", "one", "бир"],
    "2": ["два", "две", "two", "эки"],
    "3": ["три", "three", "үч"],
    "4": ["четыре", "four", "төрт"],
    "5": ["пять", "five", "беш"],
    "6": ["шесть", "six", "алты"],
    "7": ["семь", "seven", "жети"],
    "8": ["восемь", "eight", "сегиз"],
    "9": ["девять", "nine", "тогуз"],
    "10": ["десять", "ten", "он"],
  };
  const compact = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const grouped = new Map<string, Set<string>>();
  for (const sku of skus) {
    const key = compact(sku);
    const group = grouped.get(key) ?? new Set<string>();
    group.add(sku);
    grouped.set(key, group);
  }
  let result = text;
  for (const group of grouped.values()) {
    if (group.size !== 1) continue;
    const [sku] = [...group];
    const pieces = sku.split(/[\s._-]+/u).filter(Boolean);
    if (pieces.length < 2 || !pieces.every((p) => /^[\p{L}\p{N}]+$/u.test(p))) continue;
    const separator = "(?:[\\s._-]|дефис|defis|dfis|dash|hyphen)*";
    const numericKey = compact(sku).replace(/\d+/g, (n) => String(Number(n)));
    const ambiguousNumber = skus.some(
      (other) =>
        other !== sku && compact(other).replace(/\d+/g, (n) => String(Number(n))) === numericKey,
    );
    const tokens = pieces.map((piece) =>
      !ambiguousNumber && spokenNumbers[piece]
        ? `(?:${[piece, ...spokenNumbers[piece]].join("|")})`
        : piece,
    );
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${tokens.join(separator)}(?![\\p{L}\\p{N}])`,
      "giu",
    );
    result = result.replace(pattern, () => sku);
  }
  return result.trim();
}
