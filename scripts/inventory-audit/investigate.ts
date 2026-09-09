import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { PrismaClient } from "@prisma/client";
const configured = parseEnv(await readFile(".vercel/.env.production.local", "utf8"));
const report = JSON.parse(
  await readFile("artifacts/bazaar-stock-audit/production-reconciliation.json", "utf8"),
);
const db = new PrismaClient({ datasourceUrl: configured.DATABASE_URL });
try {
  const details = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const findings = [];
      for (const row of report.stockDrift) {
        const product = await tx.product.findUnique({
          where: { id: row.productId },
          select: { id: true, sku: true, name: true, createdAt: true },
        });
        const organization = await tx.organization.findUnique({
          where: { id: row.organizationId },
          select: { id: true, name: true },
        });
        const movements = await tx.stockMovement.findMany({
          where: { storeId: row.storeId, productId: row.productId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            qtyDelta: true,
            type: true,
            referenceType: true,
            referenceId: true,
            createdAt: true,
            note: true,
          },
        });
        const audits = await tx.auditLog.findMany({
          where: {
            organizationId: row.organizationId,
            entityId: {
              in: [
                row.productId,
                row.snapshotId,
                ...movements.flatMap((m) => (m.referenceId ? [m.referenceId] : [])),
              ],
            },
          },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            action: true,
            entity: true,
            entityId: true,
            before: true,
            after: true,
            createdAt: true,
          },
        });
        findings.push({ identity: row, product, organization, movements, audits });
      }
      return findings;
    },
    { isolationLevel: "RepeatableRead", timeout: 60_000 },
  );
  await writeFile(
    "artifacts/bazaar-stock-audit/production-investigation.json",
    JSON.stringify(details, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      details.map((row) => ({
        product: row.product,
        organization: row.organization,
        movements: row.movements,
        audits: row.audits.map((audit) => ({
          action: audit.action,
          entity: audit.entity,
          createdAt: audit.createdAt,
          beforeOnHand: (audit.before as { onHand?: number } | null)?.onHand,
          afterOnHand: (audit.after as { onHand?: number } | null)?.onHand,
        })),
      })),
    ),
  );
} finally {
  await db.$disconnect();
}
