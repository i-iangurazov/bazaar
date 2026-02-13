import { describe, expect, it } from "vitest";

import {
  filterCommandPaletteActions,
  type CommandPaletteAction,
} from "@/lib/command-palette";

const actions: CommandPaletteAction[] = [
  {
    id: "sale",
    category: "documents",
    label: "Заказ клиента",
    keywords: ["продажа", "документ"],
    href: "/sales/orders/new",
  },
  {
    id: "supplier",
    category: "other",
    label: "Поставщик",
    keywords: ["контрагент", "закупка"],
    href: "/suppliers/new",
  },
  {
    id: "bundle",
    category: "products",
    label: "Набор",
    keywords: ["комплект", "товар"],
    href: "/products/new?type=bundle",
  },
];

describe("command palette filtering", () => {
  it("returns all actions for an empty query", () => {
    expect(filterCommandPaletteActions(actions, "")).toHaveLength(actions.length);
  });

  it("trims query and preserves source ordering", () => {
    const result = filterCommandPaletteActions(actions, "  а  ");
    expect(result.map((item) => item.id)).toEqual(["sale", "supplier", "bundle"]);
  });

  it("filters by label and keywords (case-insensitive)", () => {
    const byLabel = filterCommandPaletteActions(actions, "ПОСТАВ");
    expect(byLabel.map((item) => item.id)).toEqual(["supplier"]);

    const byKeyword = filterCommandPaletteActions(actions, "документ");
    expect(byKeyword.map((item) => item.id)).toEqual(["sale"]);
  });

  it("returns an empty list when nothing matches", () => {
    const none = filterCommandPaletteActions(actions, "zzzz-not-found");
    expect(none).toEqual([]);
  });
});
