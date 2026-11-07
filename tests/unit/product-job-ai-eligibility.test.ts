import { describe, expect, it, vi } from "vitest";
vi.mock("@/server/db/prisma", () => ({ prisma: {} }));
import { productDescriptionJobNeedsAi } from "@/server/services/productDescriptionGenerationJobs";
const product = {
  description: "Existing",
  photoUrl: "https://cdn.example.com/photo.jpg",
  images: [],
  category: "Catalog",
  variants: [],
};
const color = {
  attributeKey: "color",
  labelRu: "Цвет",
  type: "TEXT" as const,
  optionsRu: [],
  autofillKind: "color" as const,
};
describe("product job provider eligibility", () => {
  it("does not reserve for an image-free item but leaves deterministic metadata work possible", () => {
    expect(
      productDescriptionJobNeedsAi({
        product: { ...product, description: null, photoUrl: null },
        overwriteExisting: true,
        templateSpecs: [color],
      }),
    ).toBe(false);
  });
  it("reserves an image-backed missing description even without a category", () => {
    expect(
      productDescriptionJobNeedsAi({
        product: { ...product, description: null, category: null },
        overwriteExisting: false,
        templateSpecs: [],
      }),
    ).toBe(true);
  });
  it("does not reserve for already-filled descriptions and specifications", () => {
    expect(
      productDescriptionJobNeedsAi({
        product: {
          ...product,
          variants: [{ id: "v", attributes: { color: "Black" }, attributeValues: [] }],
        },
        overwriteExisting: false,
        templateSpecs: [color],
      }),
    ).toBe(false);
  });
  it("recognizes values in normalized variant-value rows as existing", () => {
    expect(
      productDescriptionJobNeedsAi({
        product: {
          ...product,
          variants: [
            { id: "v", attributes: {}, attributeValues: [{ key: "color", value: "Black" }] },
          ],
        },
        overwriteExisting: false,
        templateSpecs: [color],
      }),
    ).toBe(false);
  });
  it("does not reserve for manufacturer/model metadata-only completion", () => {
    expect(
      productDescriptionJobNeedsAi({
        product,
        overwriteExisting: false,
        templateSpecs: [
          { ...color, attributeKey: "brand", autofillKind: "manufacturer" },
          { ...color, attributeKey: "model", autofillKind: "model" },
        ],
      }),
    ).toBe(false);
  });
  it("reserves missing image-supported fields and explicit overwrite", () => {
    expect(
      productDescriptionJobNeedsAi({ product, overwriteExisting: false, templateSpecs: [color] }),
    ).toBe(true);
    expect(
      productDescriptionJobNeedsAi({ product, overwriteExisting: true, templateSpecs: [] }),
    ).toBe(true);
  });
});
