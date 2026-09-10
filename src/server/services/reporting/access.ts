import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { readBaamAccessScope, getBaamAccessScope } from "@/server/services/baamMetrics";
import { AppError } from "@/server/services/errors";

type Actor = { id: string; organizationId: string };
type Access = Awaited<ReturnType<typeof readBaamAccessScope>>;

/** Fresh membership and report data are read together, never from a client-provided organization. */
export async function withReportRead<T>(
  actor: Actor,
  options: { storeId?: string; export?: boolean; adminOnly?: boolean; requireAnalytics?: boolean },
  read: (tx: Prisma.TransactionClient, access: Access) => Promise<T>,
) {
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '20s'`;
      const access = await readBaamAccessScope(
        tx,
        actor.id,
        options.storeId,
        options.requireAnalytics ?? true,
      );
      if (
        access.organizationId !== actor.organizationId ||
        (options.adminOnly && access.role !== "ADMIN")
      )
        throw new AppError("forbidden", "FORBIDDEN", 403);
      if (options.export && !access.planFeatures.includes("exports"))
        throw new AppError("featureLockedExports", "FORBIDDEN", 403);
      return { value: await read(tx, access), access };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 },
  );
  // Export may outlive a role/store change. Never deliver it to the previous audience.
  if (options.export) {
    const current = await getBaamAccessScope(
      actor.id,
      options.storeId,
      options.requireAnalytics ?? true,
    );
    if (
      current.organizationId !== result.access.organizationId ||
      current.authorizationFingerprint !== result.access.authorizationFingerprint
    )
      throw new AppError("analyticsExportScopeChanged", "FORBIDDEN", 403);
  }
  return result.value;
}

export async function reportFilterOptions(tx: Prisma.TransactionClient, access: Access) {
  const [registers, employees, categories] = await Promise.all([
    tx.posRegister.findMany({
      where: { organizationId: access.organizationId, storeId: { in: access.storeIds } },
      select: { id: true, name: true, storeId: true, isActive: true },
      orderBy: [{ storeId: "asc" }, { name: "asc" }],
    }),
    tx.user.findMany({
      where: {
        organizationId: access.organizationId,
        OR: [
          { customerOrdersCreated: { some: { storeId: { in: access.storeIds } } } },
          { storeAccesses: { some: { storeId: { in: access.storeIds } } } },
        ],
      },
      select: { id: true, name: true, email: true, isActive: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    tx.$queryRaw<Array<{ name: string }>>`SELECT DISTINCT TRIM(value) AS name FROM "Product" p
      CROSS JOIN LATERAL unnest(ARRAY[p.category] || p.categories) value
      WHERE p."organizationId" = ${access.organizationId} AND NULLIF(TRIM(value), '') IS NOT NULL ORDER BY name`,
  ]);
  return {
    stores: access.availableStores,
    registers,
    employees: employees.map((x) => ({ id: x.id, name: x.name ?? x.email, isActive: x.isActive })),
    categories: categories.map((x) => x.name),
  };
}

export async function assertReportEntities(
  tx: Prisma.TransactionClient,
  access: Access,
  input: { registerId?: string; cashierId?: string },
) {
  if (
    input.registerId &&
    !(await tx.posRegister.findFirst({
      where: {
        id: input.registerId,
        organizationId: access.organizationId,
        storeId: { in: access.storeIds },
      },
      select: { id: true },
    }))
  )
    throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  if (
    input.cashierId &&
    input.cashierId !== "__unknown__" &&
    !(await tx.user.findFirst({
      where: { id: input.cashierId, organizationId: access.organizationId },
      select: { id: true },
    }))
  )
    throw new AppError("userNotFound", "NOT_FOUND", 404);
}
