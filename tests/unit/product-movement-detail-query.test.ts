import type { Prisma } from "@prisma/client";
import { expect, it, vi } from "vitest";

import { getProductMovementDocument } from "@/server/services/productMovements";

it("scopes the materialized ledger, archive lookup and line query to the selected transfer", async () => {
  const ref = "selected:document";
  const documentKey = `TRANSFER:TRANSFER:${ref}`;
  const query = vi.fn()
    .mockResolvedValueOnce([{
      id: documentKey,
      documentId: ref,
      documentReferenceType: "TRANSFER",
      documentReferenceId: ref,
      documentType: "TRANSFER",
      status: "POSTED",
      positionsCount: 0,
      totalQuantity: 0,
      totalAmount: null,
      paidAmount: null,
    }])
    .mockResolvedValueOnce([]);
  await getProductMovementDocument(
    { $queryRaw: query } as unknown as Prisma.TransactionClient,
    { id: "admin", role: "ADMIN", organizationId: "org" },
    documentKey,
  );

  const summary = query.mock.calls[0]?.[0] as Prisma.Sql;
  const lines = query.mock.calls[1]?.[0] as Prisma.Sql;
  const [ledger, rest] = summary.sql.split("archive_references AS MATERIALIZED", 2);
  const archives = rest?.split("document_index_base", 1)[0];
  const indexedPredicate = 'm."referenceType" = ? AND m."referenceId" = ?';
  expect(ledger).toContain(indexedPredicate);
  expect(archives).toContain(indexedPredicate);
  expect(lines.sql).toContain(indexedPredicate);
  expect(summary.values).toEqual(expect.arrayContaining([ref, documentKey]));
  expect(lines.values).toContain(ref);
  expect(summary.sql).not.toContain(ref);
});
