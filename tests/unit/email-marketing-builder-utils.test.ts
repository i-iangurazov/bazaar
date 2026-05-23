import { describe, expect, it } from "vitest";

import {
  deleteBuilderBlock,
  duplicateBuilderBlock,
  insertBuilderBlock,
  moveBuilderBlock,
  reorderBuilderBlocks,
  updateBuilderBlock,
} from "@/app/(app)/operations/integrations/email-marketing/builder-utils";

type TestBlock =
  | { id: string; type: "text"; heading?: string; body?: string }
  | { id: string; type: "products"; productIds?: string[] }
  | { id: string; type: "footer"; text?: string };

const blocks = (): TestBlock[] => [
  { id: "header", type: "text", heading: "Header" },
  { id: "products", type: "products", productIds: ["product-1"] },
  { id: "footer", type: "footer", text: "Footer" },
];

describe("email marketing builder block operations", () => {
  it("adds a block at a specific position", () => {
    const next = insertBuilderBlock(blocks(), { id: "new-text", type: "text", body: "New" }, 1);

    expect(next.map((block) => block.id)).toEqual(["header", "new-text", "products", "footer"]);
  });

  it("updates a block without mutating other blocks", () => {
    const current = blocks();
    const next = updateBuilderBlock(current, "header", { heading: "Updated heading" });

    expect(next[0]).toMatchObject({ id: "header", heading: "Updated heading" });
    expect(next[1]).toBe(current[1]);
  });

  it("deletes a block and leaves deleted content out of serialized drafts", () => {
    const next = deleteBuilderBlock(blocks(), "products");
    const persisted = JSON.parse(JSON.stringify(next)) as TestBlock[];

    expect(persisted.map((block) => block.id)).toEqual(["header", "footer"]);
    expect(JSON.stringify(persisted)).not.toContain("product-1");
  });

  it("duplicates a block directly after the source block", () => {
    const result = duplicateBuilderBlock(blocks(), "products", (block) => `${block.id}-copy`);

    expect(result.duplicated).toMatchObject({ id: "products-copy", productIds: ["product-1"] });
    expect(result.blocks.map((block) => block.id)).toEqual([
      "header",
      "products",
      "products-copy",
      "footer",
    ]);
  });

  it("moves a block up and down with boundary protection", () => {
    expect(moveBuilderBlock(blocks(), "products", -1).map((block) => block.id)).toEqual([
      "products",
      "header",
      "footer",
    ]);
    expect(moveBuilderBlock(blocks(), "footer", 1).map((block) => block.id)).toEqual([
      "header",
      "products",
      "footer",
    ]);
  });

  it("reorders a dragged block over another block", () => {
    const next = reorderBuilderBlocks(blocks(), "footer", "header");

    expect(next.map((block) => block.id)).toEqual(["footer", "header", "products"]);
  });
});
