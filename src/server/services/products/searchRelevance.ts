type SearchableProduct = {
  id?: string;
  name: string;
  sku?: string | null;
  primaryBarcode?: string | null;
  barcodes?: Array<string | { value: string }>;
};

type ProductSearchScore = {
  rank: number;
  index: number;
  missingTokens: number;
  nameLength: number;
};

const missScore: ProductSearchScore = {
  rank: 99,
  index: Number.MAX_SAFE_INTEGER,
  missingTokens: Number.MAX_SAFE_INTEGER,
  nameLength: Number.MAX_SAFE_INTEGER,
};

export const normalizeProductSearchText = (value: string | null | undefined) =>
  (value ?? "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();

export const tokenizeProductSearchText = (value: string | null | undefined) =>
  normalizeProductSearchText(value).match(/[\p{L}\p{N}]+/gu) ?? [];

const getBarcodeValues = (product: SearchableProduct) => {
  const values =
    product.barcodes?.map((barcode) => (typeof barcode === "string" ? barcode : barcode.value)) ??
    [];
  if (product.primaryBarcode) {
    values.unshift(product.primaryBarcode);
  }
  return values;
};

export const scoreProductSearchRelevance = (
  query: string,
  product: SearchableProduct,
): ProductSearchScore => {
  const needle = normalizeProductSearchText(query);
  if (!needle) {
    return missScore;
  }

  const name = normalizeProductSearchText(product.name);
  const sku = normalizeProductSearchText(product.sku);
  const barcodes = getBarcodeValues(product).map(normalizeProductSearchText).filter(Boolean);
  const queryTokens = tokenizeProductSearchText(query);
  const nameTokens = tokenizeProductSearchText(product.name);
  const nameLength = name.length || Number.MAX_SAFE_INTEGER;
  const nameIndex = name.indexOf(needle);
  const tokenPrefixIndex = nameTokens.findIndex((token) => token.startsWith(needle));
  const missingNameTokens = queryTokens.filter(
    (queryToken) => !nameTokens.some((nameToken) => nameToken.includes(queryToken)),
  ).length;

  if (sku === needle || barcodes.some((barcode) => barcode === needle)) {
    return { rank: 0, index: 0, missingTokens: 0, nameLength };
  }
  if (name === needle) {
    return { rank: 1, index: 0, missingTokens: 0, nameLength };
  }
  if (name.startsWith(needle)) {
    return { rank: 2, index: 0, missingTokens: missingNameTokens, nameLength };
  }
  if (tokenPrefixIndex >= 0) {
    return { rank: 3, index: tokenPrefixIndex, missingTokens: missingNameTokens, nameLength };
  }
  if (nameIndex >= 0) {
    return { rank: 4, index: nameIndex, missingTokens: missingNameTokens, nameLength };
  }
  if (queryTokens.length > 1 && missingNameTokens === 0) {
    return { rank: 5, index: 0, missingTokens: 0, nameLength };
  }
  if (sku.startsWith(needle) || barcodes.some((barcode) => barcode.startsWith(needle))) {
    return { rank: 6, index: 0, missingTokens: missingNameTokens, nameLength };
  }
  if (sku.includes(needle) || barcodes.some((barcode) => barcode.includes(needle))) {
    return { rank: 7, index: 0, missingTokens: missingNameTokens, nameLength };
  }

  return missScore;
};

const compareScores = (left: ProductSearchScore, right: ProductSearchScore) =>
  left.rank - right.rank ||
  left.missingTokens - right.missingTokens ||
  left.index - right.index ||
  left.nameLength - right.nameLength;

export const compareProductSearchRelevance = <TProduct extends SearchableProduct>({
  query,
  left,
  right,
  collator,
  tieBreaker,
}: {
  query: string;
  left: TProduct;
  right: TProduct;
  collator: Intl.Collator;
  tieBreaker?: (left: TProduct, right: TProduct) => number;
}) => {
  const scoreResult = compareScores(
    scoreProductSearchRelevance(query, left),
    scoreProductSearchRelevance(query, right),
  );
  if (scoreResult !== 0) {
    return scoreResult;
  }

  const tieResult = tieBreaker?.(left, right) ?? 0;
  if (tieResult !== 0) {
    return tieResult;
  }

  return (
    collator.compare(left.name, right.name) ||
    collator.compare(left.sku ?? "", right.sku ?? "") ||
    (left.id ?? "").localeCompare(right.id ?? "")
  );
};
