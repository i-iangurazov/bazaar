const parse = (value: string) =>
  value
    .split("-", 1)[0]
    ?.split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10)) ?? [];

export const compareAppVersions = (left: string, right: string) => {
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
};
