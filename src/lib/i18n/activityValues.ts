/** Normalize audit JSON scalars to ICU arguments without losing zero or select booleans. */
export const activityTranslationValues = (
  values?: Record<string, string | number | boolean | null>,
): Record<string, string | number> => Object.fromEntries(
  Object.entries(values ?? {}).map(([key, value]) => [
    key,
    typeof value === "boolean" ? String(value) : value ?? "",
  ]),
);
