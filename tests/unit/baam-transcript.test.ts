import { describe, expect, it } from "vitest";
import { normalizeBaamTranscript } from "@/server/services/baamTranscript";
describe("Baam spoken catalog identifiers", () => {
  it.each([
    "Найди товар AI Defis QA Defis 3",
    "Найди товар AIDFIS QADFIS3",
    "Найди товар AI QA 3",
    "Найди товар ai-qa-3",
  ])("normalizes known, unambiguous punctuation: %s", (text) => {
    expect(normalizeBaamTranscript(text, ["AI-QA-3", "AI-QA-8"])).toBe("Найди товар AI-QA-3");
  });
  it("never guesses missing letters, changes quantities or selects an ambiguous SKU", () => {
    expect(normalizeBaamTranscript("Оприходуй 30 штук AIQ3", ["AI-QA-3"])).toBe(
      "Оприходуй 30 штук AIQ3",
    );
    expect(normalizeBaamTranscript("Найди AI QA 3", ["AI-QA-3", "AI_QA_3"])).toBe("Найди AI QA 3");
    expect(normalizeBaamTranscript("Найди AI QA 30", ["AI-QA-3"])).toBe("Найди AI QA 30");
    expect(normalizeBaamTranscript("Прими две штуки Test один", ["TEST-1"])).toBe(
      "Прими две штуки TEST-1",
    );
    expect(normalizeBaamTranscript("Найди Test один", ["TEST-1", "TEST-01"])).toBe(
      "Найди Test один",
    );
  });
});
