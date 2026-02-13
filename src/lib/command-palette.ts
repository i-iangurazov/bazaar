export type CommandPaletteCategory = "documents" | "products" | "other" | "payments";

export type CommandPaletteAction = {
  id: string;
  category: CommandPaletteCategory;
  label: string;
  keywords: string[];
  href: string;
};

const normalize = (value: string) => value.trim().toLowerCase();

export const filterCommandPaletteActions = (
  actions: CommandPaletteAction[],
  query: string,
): CommandPaletteAction[] => {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return actions;
  }

  return actions.filter((action) => {
    const haystack = [action.label, ...action.keywords].map((item) => normalize(item));
    return haystack.some((item) => item.includes(normalizedQuery));
  });
};
