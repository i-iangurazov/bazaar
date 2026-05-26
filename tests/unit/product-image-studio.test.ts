import { describe, expect, it, vi } from "vitest";
import {
  ProductImageStudioBackground,
  ProductImageStudioOutputFormat,
} from "@prisma/client";

vi.mock("@/server/db/prisma", () => ({
  prisma: {},
}));
vi.mock("@/server/jobs", () => ({
  registerJob: vi.fn(),
  runJob: vi.fn(),
}));
vi.mock("@/server/services/audit", () => ({
  writeAuditLog: vi.fn(),
}));
vi.mock("@/server/services/productImageStorage", () => ({
  downloadRemoteImage: vi.fn(),
  isManagedProductImageUrl: vi.fn(),
  normalizeProductImageUrl: vi.fn(),
  uploadProductImageBuffer: vi.fn(),
}));

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

    expect(prompt).toContain("Retouch the provided product photo");
    expect(prompt).toContain("Sneaker X");
    expect(prompt).toContain("light gray studio background");
    expect(prompt).toContain("not a new product generation");
    expect(prompt).toContain("Preserve the exact same real product");
    expect(prompt).toContain("Do not change the product variant");
    expect(prompt).toContain("Do not replace the item with a similar product");
  });

  it("appends identity-preservation guardrails", () => {
    const guarded = ensurePromptPreservesProductIdentity("Base instruction");

    expect(guarded).toContain("Base instruction");
    expect(guarded).toContain("invent missing details");
    expect(guarded).toContain("Only improve background");
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
