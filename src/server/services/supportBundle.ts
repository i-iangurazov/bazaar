import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";

const sensitiveKeyPattern =
  /(password|token|secret|api.?key|authorization|cookie|credential|hash|session)/i;

const redactSensitive = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitive(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[REDACTED]" : redactSensitive(entry),
    ]),
  );
};

export const getSupportBundle = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
}) =>
  prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });

    const stores = await tx.store.findMany({
      where: { organizationId: input.organizationId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        allowNegativeStock: true,
        trackExpiryLots: true,
        currencyCode: true,
        createdAt: true,
        updatedAt: true,
        featureFlags: {
          select: { id: true, storeId: true, key: true, enabled: true, updatedAt: true },
          orderBy: { key: "asc" },
        },
      },
    });

    const users = await tx.user.findMany({
      where: { organizationId: input.organizationId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        preferredLocale: true,
        createdAt: true,
      },
    });

    const recentMovements = await tx.stockMovement.findMany({
      where: { store: { organizationId: input.organizationId } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const recentPurchaseOrders = await tx.purchaseOrder.findMany({
      where: { organizationId: input.organizationId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        lines: true,
        supplier: { select: { id: true, name: true } },
        store: { select: { id: true, name: true, code: true } },
      },
    });

    const recentAuditLogs = await tx.auditLog.findMany({
      where: { organizationId: input.organizationId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        actorId: true,
        action: true,
        entity: true,
        entityId: true,
        before: true,
        after: true,
        requestId: true,
        createdAt: true,
      },
    });

    const bundle = {
      generatedAt: new Date().toISOString(),
      organization,
      stores,
      users,
      recentMovements,
      recentPurchaseOrders,
      recentAuditLogs: recentAuditLogs.map((entry) => ({
        ...entry,
        before: redactSensitive(entry.before),
        after: redactSensitive(entry.after),
      })),
    };

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "SUPPORT_BUNDLE_EXPORT",
      entity: "SupportBundle",
      entityId: input.organizationId,
      after: toJson({ generatedAt: bundle.generatedAt }),
      requestId: input.requestId,
    });

    return bundle;
  });
