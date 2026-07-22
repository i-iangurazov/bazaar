import { prisma } from "../src/server/db/prisma";
import {
  inspectProductCostMismatch,
  type ProductCostMismatchStatus,
} from "../src/server/services/productCost";

const argumentValue = (name: string) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1]?.trim() ?? null);
};

const organizationId = argumentValue("--organization-id");
const productId = argumentValue("--product-id");
const cursor = argumentValue("--cursor");
const parsedLimit = Number(argumentValue("--limit") ?? "100");
const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 && parsedLimit <= 500
  ? parsedLimit
  : null;

if (!organizationId || !limit) {
  throw new Error(
    "Usage: node --import tsx scripts/product-cost-mismatch-report.ts --organization-id <id> [--product-id <id>] [--cursor <product-id>] [--limit 1..500]",
  );
}

const scan = await prisma.$transaction(async (tx) => {
  const products = await tx.product.findMany({
    where: {
      organizationId,
      ...(productId ? { id: productId } : cursor ? { id: { gt: cursor } } : {}),
    },
    select: { id: true },
    orderBy: { id: "asc" },
    take: productId ? 1 : limit + 1,
  });
  const hasMore = !productId && products.length > limit;
  const productIds = products.slice(0, limit).map((product) => product.id);
  const nextCursor = hasMore ? productIds.at(-1) ?? null : null;
  if (!productIds.length) {
    return { rows: [], productCount: 0, hasMore, nextCursor };
  }
  const [costRows, movementRows] = await Promise.all([
    tx.productCost.findMany({
      where: { organizationId, productId: { in: productIds } },
      select: { productId: true, variantId: true },
    }),
    tx.stockMovement.findMany({
      where: {
        productId: { in: productIds },
        store: { organizationId },
        OR: [
          { type: "RECEIVE" },
          { type: "ADJUSTMENT", referenceType: "IMPORT_ROLLBACK" },
        ],
      },
      select: { productId: true, variantId: true },
      distinct: ["productId", "variantId"],
    }),
  ]);
  const scopes = new Map<string, { productId: string; variantId: string | null }>();
  for (const row of [...costRows, ...movementRows]) {
    scopes.set(`${row.productId}:${row.variantId ?? "BASE"}`, {
      productId: row.productId,
      variantId: row.variantId ?? null,
    });
  }

  const reports = [];
  for (const scope of scopes.values()) {
    reports.push({
      ...scope,
      ...(await inspectProductCostMismatch(tx, {
        organizationId,
        productId: scope.productId,
        variantId: scope.variantId,
      })),
    });
  }
  return { rows: reports, productCount: productIds.length, hasMore, nextCursor };
});

const statusCounts: Record<ProductCostMismatchStatus, number> = {
  MATCH: 0,
  MISMATCH: 0,
  INVALID_AUTHORITATIVE_STREAM: 0,
  INDETERMINATE_UNVALUED_STREAM: 0,
};
for (const row of scan.rows) {
  statusCounts[row.status] += 1;
}

const output = {
  generatedAt: new Date().toISOString(),
  readOnly: true,
  organizationId,
  productId,
  page: { limit, cursor, nextCursor: scan.nextCursor, hasMore: scan.hasMore },
  totals: { productsScanned: scan.productCount, scopes: scan.rows.length, ...statusCounts },
  rows: scan.rows,
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

if (scan.rows.some((row) => row.status !== "MATCH")) {
  process.exitCode = 2;
}

await prisma.$disconnect();
