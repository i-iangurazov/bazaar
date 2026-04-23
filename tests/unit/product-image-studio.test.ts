import { describe, expect, it } from "vitest";
import {
  ProductImageStudioBackground,
  ProductImageStudioOutputFormat,
} from "@prisma/client";

import {
  buildProductImageEditInstruction,
  ensurePromptPreservesProductIdentity,
  normalizeProviderError,
  validatePresetSelection,
} from "@/server/services/productImageStudio";

describe("product image studio helpers", () => {
  it("builds a constrained marketplace-edit prompt", () => {
    const prompt = buildProductImageEditInstruction({
      productName: "Sneaker X",
      backgroundMode: ProductImageStudioBackground.LIGHT_GRAY,
      outputFormat: ProductImageStudioOutputFormat.SQUARE,
      centered: true,
      improveVisibility: true,
      softShadow: true,
      tighterCrop: false,
      brighterPresentation: true,
    });

    expect(prompt).toContain("Edit the provided product photo");
    expect(prompt).toContain("Sneaker X");
    expect(prompt).toContain("light gray studio background");
    expect(prompt).toContain("Preserve the exact same real product");
    expect(prompt).toContain("Do not change the product variant");
  });

  it("appends identity-preservation guardrails", () => {
    const guarded = ensurePromptPreservesProductIdentity("Base instruction");

    expect(guarded).toContain("Base instruction");
    expect(guarded).toContain("Do not invent missing details");
    expect(guarded).toContain("Keep the result realistic");
  });

  it("rejects unsupported preset combinations", () => {
    expect(() =>
      validatePresetSelection({
        backgroundMode: ProductImageStudioBackground.WHITE,
        outputFormat: ProductImageStudioOutputFormat.SQUARE,
        centered: false,
        improveVisibility: true,
        softShadow: false,
        tighterCrop: false,
        brighterPresentation: false,
      }),
    ).toThrowError("productImageStudioInvalidPreset");
  });

  it("normalizes transient provider failures", () => {
    expect(
      normalizeProviderError({
        status: 429,
        body: {
          error: {
            message: "Too many requests",
            type: "rate_limit_error",
          },
        },
      }),
    ).toEqual({
      code: "RATE_LIMITED",
      status: 429,
      message: "Too many requests",
      retryable: true,
      body: {
        id: null,
        status: null,
        incomplete_details: null,
        error: {
          message: "Too many requests",
          type: "rate_limit_error",
        },
        output: [],
      },
    });
  });
});
