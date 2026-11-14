import { describe, expect, it } from "vitest";
import { scoreWideQuery, wideMetrics, type WideProduct, type WideQuery } from "../../scripts/qa/wide-photo-metrics";

const products: WideProduct[] = [
  { id: "a", name: "Red cup", known: true, dataset: "sop", category: "mug" },
  { id: "b", name: "Blue cup", known: true, dataset: "sop", category: "mug" },
  { id: "c", name: "Yellow cup", known: false, dataset: "sop", category: "mug" },
];
const query = (patch: Partial<WideQuery> = {}): WideQuery => ({ query: "q", productId: "a", dataset: "sop", category: "mug",
  ms: 1, known: true, counterfactual: false, hard: false, analysis: { regionSource: "full", region: null, ocrStatus: "ready", lines: [] },
  matches: [{ productId: "b", score: .9 }, { productId: "a", score: .67 }], ...patch });

describe("wide assortment evaluation accounting", () => {
  it("distinguishes a raw near match, a wrong visible first candidate, and an empty result", () => {
    const rows = [scoreWideQuery(query(), products), scoreWideQuery(query({ matches: [] }), products)];
    expect(wideMetrics(rows)).toMatchObject({ known: 2, rawRecallAt5: 1, visibleRecallAt5: 0, wrongVisibleFirst: 1, knownEmpty: 1 });
  });
  it("counts similar absent queries separately without inflating known accuracy", () => {
    const absent = scoreWideQuery(query({ known: false, productId: "c" }), products);
    expect(absent.sameCategoryKnown).toBe(true);
    expect(wideMetrics([absent])).toMatchObject({ known: 0, visibleCorrectFirst: 0, absent: 1, absentWithCandidates: 1 });
  });
  it("cannot recover a removed target from OCR metadata in the counterfactual store", () => {
    const product = { ...products[0], name: "ELFBAR GH23000 Miami Mint" };
    const row = query({ known: false, counterfactual: true, matches: [], analysis: {
      regionSource: "full", region: null, ocrStatus: "ready", lines: [{ text: "MIAMI MINT", confidence: .99, box: { x: 0, y: 0, width: 1, height: 1 } }],
    } });
    expect(scoreWideQuery(row, [product, products[1]]).candidates).toEqual([]);
  });
});
