import { describe, expect, it } from "vitest";

import {
  deleteBuilderBlock,
  duplicateBuilderBlock,
  insertBuilderBlock,
  moveBuilderBlock,
  reorderBuilderBlocks,
  resolveBuilderPreviewImageSrc,
  updateBuilderBlock,
} from "@/app/(app)/operations/integrations/email-marketing/builder-utils";

type TestBlock =
  | {
      id: string;
      type: "text";
      heading?: string;
      body?: string;
      alignment?: "left" | "center" | "right";
    }
  | { id: string; type: "products"; productIds?: string[]; alignment?: "left" | "center" | "right" }
  | { id: string; type: "footer"; text?: string; alignment?: "left" | "center" | "right" };

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
    const next = updateBuilderBlock(current, "header", {
      heading: "Updated heading",
      alignment: "center",
    });

    expect(next[0]).toMatchObject({
      id: "header",
      heading: "Updated heading",
      alignment: "center",
    });
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

  it("allows only explicit HTTP(S) and same-origin image paths in the builder preview", () => {
    expect(resolveBuilderPreviewImageSrc(" https://cdn.example.com/banner.png ")).toBe(
      "https://cdn.example.com/banner.png",
    );
    expect(resolveBuilderPreviewImageSrc("http://cdn.example.com/banner.png")).toBe(
      "http://cdn.example.com/banner.png",
    );
    expect(resolveBuilderPreviewImageSrc("/uploads/product-images/banner.png")).toBe(
      "/uploads/product-images/banner.png",
    );

    for (const unsafe of [
      "javascript:alert(1)",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "blob:https://example.com/id",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
      "//evil.example/banner.svg",
      "https://user:secret@example.com/banner.png",
      "https://example.com/banner.png\njavascript:alert(1)",
      "not a URL",
    ]) {
      expect(resolveBuilderPreviewImageSrc(unsafe), unsafe).toBeNull();
    }
  });
});
