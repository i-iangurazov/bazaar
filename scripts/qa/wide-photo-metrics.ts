import { matchProductPhotoLabel } from "../../src/server/services/productPhotoLabel";
import { productPhotoSearchMinScore, type ProductPhotoAnalysis } from "../../src/lib/productPhotoSearch";

export type WideProduct = { id: string; name: string; known: boolean; dataset: string; category: string; family?: string };
export type WideQuery = { query: string; dataset: string; category: string; known: boolean; counterfactual: boolean; hard: boolean;
  productId: string; ms: number; analysis: ProductPhotoAnalysis; matches: { productId: string; score: number }[] };
export function scoreWideQuery(row: WideQuery, products: WideProduct[]) {
  const scope = products.filter((p) => p.known && (!row.counterfactual || p.id !== row.productId));
  const visual = row.matches.filter((m) => m.score >= productPhotoSearchMinScore).map((m) => m.productId);
  const label = matchProductPhotoLabel(row.analysis, scope, visual);
  const candidates = [...new Set([...visual, ...(label.textCandidateId ? [label.textCandidateId] : [])])];
  const matched = label.textCandidateId ? new Set([label.textCandidateId]) : label.matchedIds;
  candidates.sort((a, b) => Number(matched.has(b))-Number(matched.has(a)));
  const target = products.find((p) => p.id === row.productId)!;
  return { ...row, candidates: candidates.slice(0, 8), labelStatus: label.textCandidateId ? "matched" : label.status,
    sameCategoryKnown: scope.some((p) => p.dataset === target.dataset && p.category === target.category) };
}
export type ScoredWideQuery = ReturnType<typeof scoreWideQuery>;
export function wideMetrics(selected: ScoredWideQuery[]) {
  const known = selected.filter((r) => r.known), absent = selected.filter((r) => !r.known);
  const rank = (r: ScoredWideQuery, raw = false) => (raw ? r.matches.map((m) => m.productId) : r.candidates).indexOf(r.productId);
  return { queries: selected.length, known: known.length, knownIdentities: new Set(known.map((r) => r.productId)).size,
    rawCorrectFirst: known.filter((r) => rank(r, true) === 0).length,
    rawRecallAt5: known.filter((r) => rank(r, true) >= 0 && rank(r, true) < 5).length,
    visibleCorrectFirst: known.filter((r) => rank(r) === 0).length,
    visibleRecallAt5: known.filter((r) => rank(r) >= 0 && rank(r) < 5).length,
    visibleRecallAt8: known.filter((r) => rank(r) >= 0).length,
    wrongVisibleFirst: known.filter((r) => r.candidates.length && rank(r) !== 0).length,
    knownEmpty: known.filter((r) => !r.candidates.length).length,
    absent: absent.length, absentIdentities: new Set(absent.map((r) => r.productId)).size,
    absentWithCandidates: absent.filter((r) => r.candidates.length).length,
    matchedLabels: selected.filter((r) => r.labelStatus === "matched").length };
}
