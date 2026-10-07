import { Prisma } from "@prisma/client";
import { normalizeScanValue } from "@/lib/scanning/normalize";
import { normalizeProductSearchText, tokenizeProductSearchText } from "./searchRelevance";

export type ProductSearchField = "name" | "sku" | "barcode" | "packBarcode";
const allFields: ProductSearchField[] = ["name", "sku", "barcode", "packBarcode"];

// All expressions use the fixed Product alias p. Search values stay bound parameters.
export function buildProductSearchScoreSql(query: string, fields = allFields) {
  const enabled = new Set(fields);
  const needle = normalizeProductSearchText(query);
  const barcodeNeedle = normalizeProductSearchText(normalizeScanValue(query) || query);
  const tokens = tokenizeProductSearchText(query);
  const name = Prisma.sql`LOWER(p."name")`;
  const identifierMatch = (mode: "exact" | "prefix" | "contains") => {
    const compare = (column: Prisma.Sql, value: string) =>
      mode === "exact"
        ? Prisma.sql`LOWER(${column}) = ${value}`
        : mode === "prefix"
          ? Prisma.sql`LEFT(LOWER(${column}), CHAR_LENGTH(${value})) = ${value}`
          : Prisma.sql`POSITION(${value} IN LOWER(${column})) > 0`;
    const checks: Prisma.Sql[] = [];
    if (enabled.has("sku")) checks.push(compare(Prisma.sql`p."sku"`, needle));
    if (enabled.has("barcode"))
      checks.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ProductBarcode" b WHERE b."productId" = p.id AND ${compare(Prisma.sql`b."value"`, barcodeNeedle)}
    )`);
    if (enabled.has("packBarcode"))
      checks.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ProductPack" pack WHERE pack."productId" = p.id AND ${compare(Prisma.sql`pack."packBarcode"`, barcodeNeedle)}
    )`);
    return checks.length ? Prisma.sql`(${Prisma.join(checks, " OR ")})` : Prisma.sql`false`;
  };
  const missingTokensSql =
    enabled.has("name") && tokens.length
      ? Prisma.join(
          tokens.map(
            (token) => Prisma.sql`CASE WHEN EXISTS (
        SELECT 1 FROM UNNEST(REGEXP_SPLIT_TO_ARRAY(${name}, '[^[:alnum:]]+')) name_token
        WHERE POSITION(${token} IN name_token) > 0
      ) THEN 0 ELSE 1 END`,
          ),
          " + ",
        )
      : Prisma.sql`0`;
  const nameRank = enabled.has("name")
    ? Prisma.sql`
    WHEN ${name} = ${needle} THEN 1
    WHEN LEFT(${name}, CHAR_LENGTH(${needle})) = ${needle} THEN 2
    WHEN EXISTS (
      SELECT 1 FROM UNNEST(REGEXP_SPLIT_TO_ARRAY(${name}, '[^[:alnum:]]+')) name_token
      WHERE LEFT(name_token, CHAR_LENGTH(${needle})) = ${needle}
    ) THEN 3
    WHEN POSITION(${needle} IN ${name}) > 0 THEN 4
    WHEN ${tokens.length > 1 ? Prisma.sql`(${missingTokensSql}) = 0` : Prisma.sql`false`} THEN 5
  `
    : Prisma.empty;
  const rankSql = Prisma.sql`CASE
    WHEN ${identifierMatch("exact")} THEN 0
    ${nameRank}
    WHEN ${identifierMatch("prefix")} THEN 6
    WHEN ${identifierMatch("contains")} THEN 7
    ELSE 99 END`;
  const tokenPrefixIndexSql = Prisma.sql`COALESCE((
    SELECT MIN(name_token.ordinality - 1)
    FROM UNNEST(REGEXP_SPLIT_TO_ARRAY(${name}, '[^[:alnum:]]+')) WITH ORDINALITY AS name_token(value, ordinality)
    WHERE LEFT(name_token.value, CHAR_LENGTH(${needle})) = ${needle}
  ), 9007199254740991)`;
  return {
    rankSql,
    missingTokensSql: Prisma.sql`CASE WHEN (${rankSql}) = 99 THEN 9007199254740991 ELSE (${missingTokensSql}) END`,
    indexSql: Prisma.sql`CASE WHEN (${rankSql}) = 3 THEN ${tokenPrefixIndexSql}
      WHEN (${rankSql}) = 4 THEN POSITION(${needle} IN ${name}) - 1
      WHEN (${rankSql}) = 99 THEN 9007199254740991 ELSE 0 END`,
    nameLengthSql: Prisma.sql`CASE WHEN (${rankSql}) = 99 THEN 9007199254740991 ELSE CHAR_LENGTH(${name}) END`,
  };
}

export async function findRankedProductIds({
  prisma,
  organizationId,
  query,
  limit,
  storeIds,
  inventoryStoreId,
  fields = allFields,
  matchTokensAcrossFields = false,
}: {
  prisma: Pick<Prisma.TransactionClient, "$queryRaw">;
  organizationId: string;
  query: string;
  limit: number;
  storeIds?: string[];
  inventoryStoreId?: string;
  fields?: ProductSearchField[];
  matchTokensAcrossFields?: boolean;
}): Promise<string[]> {
  const enabled = new Set(fields);
  const needle = normalizeProductSearchText(query);
  if (!needle || !enabled.size || !fields.some((field) => allFields.includes(field))) return [];
  const tokens = matchTokensAcrossFields ? needle.split(" ").slice(0, 8) : [needle];
  const conditions = [
    Prisma.sql`p."organizationId" = ${organizationId}`,
    Prisma.sql`p."isDeleted" = false`,
  ];
  if (storeIds !== undefined) {
    const assigned = storeIds.length
      ? Prisma.sql`EXISTS (
      SELECT 1 FROM "StoreProduct" assignment WHERE assignment."productId" = p.id
      AND assignment."storeId" IN (${Prisma.join(storeIds)}) AND assignment."isActive" = true
    )`
      : Prisma.sql`false`;
    // Warehouse documents retain existing stock after a catalogue source is disconnected.
    conditions.push(
      inventoryStoreId
        ? Prisma.sql`(${assigned} OR EXISTS (
      SELECT 1 FROM "InventorySnapshot" stock JOIN "Store" store ON store.id = stock."storeId"
      WHERE stock."productId" = p.id AND stock."storeId" = ${inventoryStoreId}
        AND store."catalogSourcesConfigured" = true
    ))`
        : assigned,
    );
  }
  for (const token of tokens) {
    const matches: Prisma.Sql[] = [];
    if (enabled.has("name")) {
      matches.push(Prisma.sql`POSITION(${token} IN LOWER(p."name")) > 0`);
      const nameTokens = tokenizeProductSearchText(query);
      if (!matchTokensAcrossFields && nameTokens.length > 1)
        matches.push(
          Prisma.sql`(${Prisma.join(
            nameTokens.map((word) => Prisma.sql`POSITION(${word} IN LOWER(p."name")) > 0`),
            " AND ",
          )})`,
        );
    }
    if (enabled.has("sku")) matches.push(Prisma.sql`POSITION(${token} IN LOWER(p."sku")) > 0`);
    const barcodeNeedle = normalizeProductSearchText(normalizeScanValue(token) || token);
    if (enabled.has("barcode"))
      matches.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ProductBarcode" b WHERE b."productId" = p.id AND POSITION(${barcodeNeedle} IN LOWER(b."value")) > 0
    )`);
    if (enabled.has("packBarcode"))
      matches.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ProductPack" pack WHERE pack."productId" = p.id AND POSITION(${barcodeNeedle} IN LOWER(pack."packBarcode")) > 0
    )`);
    conditions.push(Prisma.sql`(${Prisma.join(matches, " OR ")})`);
  }
  const score = buildProductSearchScoreSql(query, fields);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT p.id FROM "Product" p WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY ${score.rankSql}, ${score.missingTokensSql}, ${score.indexSql}, ${score.nameLengthSql},
      LOWER(p."name"), LOWER(p."sku"), p.id LIMIT ${limit}
  `);
  return rows.map((row) => row.id);
}
