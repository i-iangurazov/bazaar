export type VariantGeneratorAttribute = {
  key: string;
  values: string[];
};

// Match the old dimensions when adding an option (e.g. size -> size + colour).
// Reuse each identity once, while new combinations inherit its price/settings.
export function findVariantTemplate<T extends { attributes?: { key: string; value?: unknown }[] }>(
  variants: T[],
  combo: Record<string, string>,
  normalizeKey: (key: string) => string,
): T | undefined {
  let best: T | undefined;
  let score = 0;
  for (const variant of variants) {
    const common = (variant.attributes ?? []).filter((entry) => normalizeKey(entry.key) in combo);
    if (
      common.length > score &&
      common.every((entry) => String(entry.value) === combo[normalizeKey(entry.key)])
    ) {
      best = variant;
      score = common.length;
    }
  }
  return best;
}

export const buildVariantMatrix = (attributes: VariantGeneratorAttribute[]) => {
  if (!attributes.length) {
    return [] as Record<string, string>[];
  }

  if (attributes.some((attr) => attr.values.length === 0)) {
    return [] as Record<string, string>[];
  }

  return attributes.reduce<Record<string, string>[]>(
    (acc, attr) => {
      const next: Record<string, string>[] = [];
      acc.forEach((entry) => {
        attr.values.forEach((value) => {
          next.push({ ...entry, [attr.key]: value });
        });
      });
      return next;
    },
    [{}],
  );
};
