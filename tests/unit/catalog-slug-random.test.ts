import { afterEach, describe, expect, it, vi } from "vitest";

const source = vi.hoisted(() => ({ randomInt: vi.fn() }));
vi.mock("node:crypto", async (original) => ({
  ...(await original<typeof import("node:crypto")>()),
  randomInt: source.randomInt,
}));

import { createSlugCandidate } from "@/server/services/bazaarCatalog";

const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";

afterEach(() => source.randomInt.mockReset());

describe("public catalog slug compatibility and entropy source", () => {
  it("keeps the existing 12-character link format and uses bounded crypto sampling for every character", () => {
    let cursor = 0;
    source.randomInt.mockImplementation((exclusiveMaximum: number) => {
      expect(exclusiveMaximum).toBe(alphabet.length);
      return cursor++ % exclusiveMaximum;
    });
    const slugs = Array.from({ length: 3 }, createSlugCandidate);
    for (const slug of slugs) expect(slug).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{12}$/);
    expect(slugs.join("").slice(0, alphabet.length)).toBe(alphabet);
    expect(source.randomInt).toHaveBeenCalledTimes(36);
  });

  it.each([0, alphabet.length - 1])("retains the lower and upper alphabet boundaries for crypto index %s", (index) => {
    source.randomInt.mockReturnValue(index);
    expect(createSlugCandidate()).toBe(alphabet[index].repeat(12));
    expect(source.randomInt).toHaveBeenCalledWith(alphabet.length);
  });
});
