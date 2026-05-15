import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("product image uploader source", () => {
  it("keeps product create/edit and quick-create upload inputs multi-select friendly", async () => {
    const source = await readSource("src/components/product-form.tsx");
    const fileInputs = Array.from(source.matchAll(/<input[\s\S]*?type="file"[\s\S]*?\/>/g)).map(
      (match) => match[0] ?? "",
    );

    expect(fileInputs).toHaveLength(2);
    for (const input of fileInputs) {
      expect(input).toContain("accept={productImageAccept}");
      expect(input).toContain("multiple");
      expect(input).not.toContain("capture");
      expect(input).toContain("onChange={handleImageInputChange}");
    }
    expect(source).toContain("Array.from(event.target.files ?? [])");
    expect(source).not.toContain("event.target.files?.[0]");
    expect(source).not.toContain("event.target.files[0]");
  });

  it("falls back to the backend upload endpoint when direct storage PUT fails before a response", async () => {
    const source = await readSource("src/components/product-form.tsx");

    expect(source).toContain('"direct-upload-put-error"');
    expect(source).toContain("return { attempted: false, url: null };");
    expect(source).toContain("return uploadImageFileViaProxy(file);");
  });
});
