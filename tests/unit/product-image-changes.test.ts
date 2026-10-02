// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFieldArray, useForm } from "react-hook-form";
import { isProductImageOnlyChange } from "@/lib/productImageChanges";

describe("product image-only save", () => {
  it("detects photo uploads from real form and gallery array changes", () => {
    const { result } = renderHook(() => {
      const form = useForm({ defaultValues: {
        name: "Product", retailPriceKgs: 100, photoUrl: "old.webp",
        images: [{ url: "old.webp" }],
        variants: [{ id: "variant-1", name: "Small", imageId: null as string | null }],
      } });
      const gallery = useFieldArray({ control: form.control, name: "images" });
      return { form, gallery, dirtyFields: form.formState.dirtyFields };
    });
    act(() => {
      result.current.gallery.append({ url: "new.webp" });
      result.current.form.setValue("photoUrl", "new.webp", { shouldDirty: true });
      result.current.form.setValue("variants.0.imageId", "new-image", { shouldDirty: true });
    });
    expect(isProductImageOnlyChange(result.current.dirtyFields)).toBe(true);
    act(() => result.current.form.setValue("retailPriceKgs", 200, { shouldDirty: true }));
    expect(isProductImageOnlyChange(result.current.dirtyFields)).toBe(false);
  });
  it("recognizes gallery, cover and variant photo changes", () => {
    expect(isProductImageOnlyChange({ images: true, photoUrl: true })).toBe(true);
    expect(isProductImageOnlyChange({ variants: [{ imageId: true, imageUrl: true }] })).toBe(true);
  });
  it("keeps details, prices and variant edits on the normal permission path", () => {
    expect(isProductImageOnlyChange({})).toBe(false);
    expect(isProductImageOnlyChange({ images: true, name: true })).toBe(false);
    expect(isProductImageOnlyChange({ images: true, retailPriceKgs: true })).toBe(false);
    expect(isProductImageOnlyChange({ variants: [{ imageUrl: true, attributes: true }] })).toBe(
      false,
    );
    expect(isProductImageOnlyChange({ variants: true })).toBe(false);
  });
});
