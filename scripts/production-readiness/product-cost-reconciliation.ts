import { Prisma } from "@prisma/client";

import { prisma } from "../../src/server/db/prisma";
import {
  buildProductCostReconciliationReport,
  type ProductCostReconciliationCursor,
} from "../../src/server/services/productCostReconciliation";

const usage =
  "node --import tsx scripts/production-readiness/product-cost-reconciliation.ts " +
  "--organization-id <id> [--cursor <product-id>:<variant-key>] [--limit 1..500]";

const allowedFlags = new Set(["--organization-id", "--cursor", "--limit"]);
const parsed = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index];
  const value = process.argv[index + 1];
  if (!flag || !allowedFlags.has(flag) || !value || value.startsWith("--")) {
    throw new Error(`Invalid arguments. Usage: ${usage}`);
  }
  parsed.set(flag, value.trim());
}

const organizationId = parsed.get("--organization-id");
if (!organizationId) {
  throw new Error(`--organization-id is required. Usage: ${usage}`);
}

const parsedLimit = Number(parsed.get("--limit") ?? "100");
if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) {
  throw new Error(`--limit must be an integer from 1 to 500. Usage: ${usage}`);
}

const parseCursor = (value: string | undefined): ProductCostReconciliationCursor | null => {
  if (!value) {
    return null;
  }
  const separator = value.lastIndexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`--cursor must be <product-id>:<variant-key>. Usage: ${usage}`);
  }
  return {
    productId: value.slice(0, separator),
    variantKey: value.slice(separator + 1),
  };
};

try {
  const report = await prisma.$transaction(
    async (tx) => {
      // Defense in depth: even future code added to this transaction cannot write.
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return buildProductCostReconciliationReport(tx, {
        organizationId,
        cursor: parseCursor(parsed.get("--cursor")),
        limit: parsedLimit,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  process.stdout.write(
    `${JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2)}\n`,
  );

  if (
    report.page.hasMore ||
    report.totals.reviewRequired > 0 ||
    report.totals.deterministicRepair > 0
  ) {
    process.exitCode = 2;
  }
} finally {
  await prisma.$disconnect();
}
