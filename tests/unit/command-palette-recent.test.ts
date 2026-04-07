import { describe, expect, it } from "vitest";

import {
  addRecentCommandPaletteSearch,
  parseRecentCommandPaletteSearches,
} from "@/lib/command-palette-recent";

describe("command palette recent searches", () => {
  it("parses, trims, deduplicates, and caps stored searches", () => {
    const parsed = parseRecentCommandPaletteSearches(
      JSON.stringify([
        "  milk  ",
        "tea",
        "milk",
        "",
        42,
        "coffee",
        "bread",
        "sugar",
        "salt",
        "flour",
        "water",
        "juice",
      ]),
    );

    expect(parsed).toEqual([
      "milk",
      "tea",
      "coffee",
      "bread",
      "sugar",
      "salt",
      "flour",
      "water",
    ]);
  });

  it("moves repeated searches to the front and ignores empty values", () => {
    const initial = ["milk", "tea", "coffee"];

    expect(addRecentCommandPaletteSearch(initial, " tea ")).toEqual(["tea", "milk", "coffee"]);
    expect(addRecentCommandPaletteSearch(initial, "   ")).toEqual(initial);
  });
});
