import { describe, expect, it } from "vitest";
import { matchProductPhotoLabel } from "@/server/services/productPhotoLabel";
import { validProductPhotoRegion, type ProductPhotoAnalysis } from "@/lib/productPhotoSearch";

const products = [
  { id: "orange-a", name: "ELFBAR GH23000 Pineapple Plums Lime Mint" },
  { id: "orange-b", name: "ELFBAR GH23000 Peach Mango Watermelon" },
  { id: "mint-a", name: "ELFBAR GH23000 Ice Mint" },
  { id: "mint-b", name: "ELFBAR GH23000 Miami Mint" },
];
const analysis = (texts: string[], confidence = 0.98): ProductPhotoAnalysis => ({ regionSource: "full", region: null, ocrStatus: "ready",
  lines: texts.map((text, index) => ({ text, confidence, box: { x: 0.2, y: 0.1 + index * 0.05, width: 0.6, height: 0.04 } })) });
describe("OCR evidence is checked against current scoped metadata", () => {
  it("distinguishes two identical-looking orange flavors using a wrapped label", () => {
    const result = matchProductPhotoLabel(analysis(["ELFBAR", "GH23000", "PEACH MANGO", "WATERMELON"]), products, ["orange-a", "orange-b"]);
    expect(result.status).toBe("matched"); expect([...result.matchedIds]).toEqual(["orange-b"]);
    expect(result.text).toBe("PEACH MANGO WATERMELON");
  });
  it("does not confuse ice mint with miami mint or confirm a readable brand alone", () => {
    expect([...matchProductPhotoLabel(analysis(["ICE MINT"]), products, ["mint-b", "mint-a"]).matchedIds]).toEqual(["mint-a"]);
    expect(matchProductPhotoLabel(analysis(["ELFBAR", "GH23000"]), products, ["mint-b"]).status).toBe("unreadable");
    expect(matchProductPhotoLabel(analysis(["ICE MINT"], 0.7), products, ["mint-a"]).status).toBe("unreadable");
  });
  it("keeps absent flavors unconfirmed and requires independent context for text-only retrieval", () => {
    const absent = matchProductPhotoLabel(analysis(["GREEN APPLE ICE"]), products, ["mint-a"]);
    expect(absent.status).toBe("unmatched"); expect(absent.matchedIds.size).toBe(0);
    expect(matchProductPhotoLabel(analysis(["PEACH MANGO WATERMELON"]), products, ["orange-a"]).matchedIds.size).toBe(0);
    expect(matchProductPhotoLabel(analysis(["PEACH MANGO WATERMELON"]), products, ["orange-a"]).textCandidateId).toBeUndefined();
    expect(matchProductPhotoLabel(analysis(["ELFBAR", "GH23000", "ICE MINT"]), products, []).textCandidateId).toBe("mint-a");
    expect(matchProductPhotoLabel(analysis(["ELFBAR", "GH23000", "ICE MINT"]), products.map((product) => ({ ...product, name: product.name.replace("ELFBAR GH23000 ", "") })), []).textCandidateId).toBeUndefined();
    expect(matchProductPhotoLabel(analysis(["ELFBAR", "GH23000", "GREEN APPLE ICE"]), products, []).textCandidateId).toBeUndefined();
  });
  it("leaves duplicate and conflicting labels ambiguous", () => {
    expect(matchProductPhotoLabel(analysis(["ICE MINT"]), [...products, { id: "duplicate", name: products[2].name }], ["mint-a", "duplicate"]).status).toBe("ambiguous");
    expect(matchProductPhotoLabel(analysis(["ICE MINT", "MIAMI MINT"]), products, ["mint-a", "mint-b"]).status).toBe("ambiguous");
  });
  it("does not join distant text and respects the language of the current product name", () => {
    const data = analysis(["PEACH", "MANGO"]); data.lines[1].box.y = 0.8;
    expect(matchProductPhotoLabel(data, products, ["orange-b"]).status).toBe("unreadable");
    expect(matchProductPhotoLabel(analysis(["ЗЕЛЁНЫЙ ЧАЙ"]), [{ id: "tea", name: "Зелёный чай" }], ["tea"]).status).toBe("matched");
  });
  it("reports unavailable OCR without using stale recognized lines", () => {
    expect(matchProductPhotoLabel({ ...analysis(["ICE MINT"]), ocrStatus: "unavailable" }, products, ["mint-a"]).status).toBe("unavailable");
  });
  it("bounds normalized input regions including nonfinite, zero, and prototype-like extra fields", () => {
    expect(validProductPhotoRegion({ x: 0.1, y: 0.1, width: 0.5, height: 0.8 })).toBe(true);
    for (const value of [[], null, { x: 0, y: 0, width: 0, height: 1 }, { x: -1, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: Infinity, height: 1 }, { x: 0, y: 0, width: 1, height: 2 }, { x: 0, y: 0, width: 1, height: 1, extra: true }]) expect(validProductPhotoRegion(value)).toBe(false);
  });
});
