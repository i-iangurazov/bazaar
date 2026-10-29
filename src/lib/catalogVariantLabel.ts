/** Public labels must never fall back to a database identifier. */
export const catalogVariantLabel = (
  variant: { id: string; name?: string | null; attributes?: unknown },
  index: number,
) => {
  const name = variant.name?.trim();
  const isIdentifier =
    name &&
    (name === variant.id ||
      (name.length >= 6 && variant.id.startsWith(name)) ||
      /^c[a-z0-9]{24,}$/i.test(name) ||
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(name));
  if (name && !isIdentifier) return name;
  const attributes = variant.attributes;
  const values =
    attributes && typeof attributes === "object" && !Array.isArray(attributes)
      ? Object.entries(attributes)
          .sort(([left], [right]) => left.localeCompare(right))
          .flatMap(([, value]) =>
            (Array.isArray(value) ? value : [value])
              .filter((item) => typeof item === "string" || typeof item === "number")
              .map((item) => String(item).trim())
              .filter(Boolean),
          )
      : [];
  return values.length ? values.join(" · ") : `№ ${index + 1}`;
};
