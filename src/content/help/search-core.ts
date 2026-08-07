const normalize = (value: string) =>
  value
    .toLocaleLowerCase()
    .replaceAll("ё", "е")
    .replace(/[’'`]/g, "")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");

const distance = (left: string, right: string) => {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current[rightIndex + 1] = Math.min(
        (current[rightIndex] ?? 0) + 1,
        (previous[rightIndex + 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + (left[leftIndex] === right[rightIndex] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
};

export type HelpSearchDocument = {
  id: string;
  title: string;
  summary: string;
  keywords: string;
  aliases: string;
  headings: string;
  categoryTitle: string;
  categoryIcon: string;
};

export const searchHelpDocuments = (
  documents: HelpSearchDocument[],
  rawQuery: string,
  limit = 8,
) => {
  const query = normalize(rawQuery);
  if (!query) return [];
  const queryTokens = query.split(" ").filter(Boolean);

  return documents
    .map((document) => {
      const fields = {
        title: normalize(document.title),
        summary: normalize(document.summary),
        keywords: normalize(document.keywords),
        aliases: normalize(document.aliases),
        headings: normalize(document.headings),
      };
      const haystackTokens = Object.values(fields).join(" ").split(" ");
      let score = 0;
      if (fields.title === query) score += 180;
      if (fields.title.includes(query)) score += 110;
      if (fields.aliases.includes(query)) score += 100;
      if (fields.keywords.includes(query)) score += 75;
      if (fields.headings.includes(query)) score += 55;
      if (fields.summary.includes(query)) score += 35;
      let matchedTokens = 0;
      queryTokens.forEach((token) => {
        if (
          haystackTokens.some((candidate) => candidate === token || candidate.startsWith(token))
        ) {
          matchedTokens += 1;
          score += 18;
        } else if (
          token.length >= 4 &&
          haystackTokens.some(
            (candidate) => candidate.length >= 4 && distance(token, candidate) <= 1,
          )
        ) {
          matchedTokens += 1;
          score += 8;
        }
      });
      if (matchedTokens === queryTokens.length) score += 40;
      return { document, score };
    })
    .filter((result) => result.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.document.id.localeCompare(right.document.id),
    )
    .slice(0, limit);
};

export const normalizeHelpSearchQuery = normalize;
