import type { ProductPhotoAnalysis, ProductPhotoLabelStatus } from "@/lib/productPhotoSearch";

const words = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) ?? [];
const contains = (name: string[], phrase: string[]) => {
  for (let start = 0; start <= name.length - phrase.length; start += 1)
    if (phrase.every((word, offset) => name[start + offset] === word)) return true;
  return false;
};

/** Conservative metadata check after OCR, not a second image-search engine.
 * Uses only the freshly authorized store's names. A separate text-only candidate
 * requires an exact, unique multiword label plus independent brand/model context.
 * A readable model number/brand alone cannot confirm a flavor or a SKU.
 */
export function matchProductPhotoLabel(analysis: ProductPhotoAnalysis, products: { id: string; name: string }[], candidateIds: string[]) {
  const empty = (status: ProductPhotoLabelStatus, text = "", textCandidateId?: string) => ({ status, text, matchedIds: new Set<string>(), textCandidateId });
  if (analysis.ocrStatus === "unavailable") return empty("unavailable");
  const lines = analysis.lines.filter((line) => line.confidence >= 0.85 && line.text.length <= 120);
  const phrases = new Map<string, string[]>();
  for (let start = 0; start < lines.length; start += 1) {
    let text = "";
    for (let count = 0; count < 3 && start + count < lines.length; count += 1) {
      const current = lines[start + count];
      if (count) {
        const previous = lines[start + count - 1];
        // Join wrapped labels only; do not join an unrelated watermark or shelf text.
        const gap = current.box.y - (previous.box.y + previous.box.height);
        const overlap = Math.min(previous.box.x + previous.box.width, current.box.x + current.box.width) - Math.max(previous.box.x, current.box.x);
        if (gap > Math.max(previous.box.height, current.box.height) * 1.5 || gap < -Math.max(previous.box.height, current.box.height) || overlap <= 0) break;
      }
      text = (text + " " + current.text).trim();
      const tokens = words(text);
      // Two lexical words, not a model number or an isolated generic word such as 'ice'.
      if (tokens.length >= 2 && tokens.length <= 12 && tokens.every((word) => word.length >= 2 && !/\p{N}/u.test(word))) phrases.set(text, tokens);
    }
  }
  if (!phrases.size) return empty("unreadable");
  const names = products.map((product) => ({ id: product.id, words: words(product.name.slice(0, 512)) }));
  const unique = new Map<string, { text: string; length: number }>();
  const unmatched: string[] = [];
  for (const [text, phrase] of phrases) {
    const hits = names.filter((product) => contains(product.words, phrase));
    if (!hits.length) unmatched.push(text);
    if (hits.length !== 1) continue;
    const hit = hits[0];
    if ((unique.get(hit.id)?.length ?? 0) < phrase.length) unique.set(hit.id, { text, length: phrase.length });
  }
  if (unique.size > 1) return empty("ambiguous");
  if (unique.size === 1) {
    const [id, evidence] = [...unique][0];
    if (candidateIds.includes(id)) return { status: "matched" as const, text: evidence.text, matchedIds: new Set([id]), textCandidateId: undefined };
    const name = names.find((product) => product.id === id)!;
    const labelWords = new Set(words(evidence.text));
    const context = lines.some((line) => line.confidence >= 0.9 && words(line.text).some((word) => word.length >= 4 && /\p{L}/u.test(word) && !labelWords.has(word)) && contains(name.words, words(line.text)));
    return empty("unmatched", evidence.text, context ? id : undefined);
  }
  if (unmatched.length) return empty("unmatched", unmatched.sort((a, b) => words(b).length - words(a).length)[0]);
  return empty("ambiguous");
}
