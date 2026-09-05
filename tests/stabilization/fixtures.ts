import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Role, type PrismaClient, type User } from "@prisma/client";

import { assertStabilizationDatabase } from "../../scripts/stabilization/environment";
import { getLogger } from "@/server/logging";
import type { Context } from "@/server/trpc/trpc";

export const commerceRoles = [Role.ADMIN, Role.MANAGER, Role.STAFF, Role.CASHIER] as const;

/** Synthetic metadata only: no products, inventory, receipts, provider jobs or subscriptions. */
export async function createCommerceFixtures(
  db: PrismaClient,
  options: { password?: string } = {},
) {
  assertStabilizationDatabase();
  const [identity] = await db.$queryRaw<{ database: string; username: string }[]>`
    SELECT current_database() AS database, current_user AS username
  `;
  if (identity.database !== "bazaar_hardening_ci" || identity.username !== "bazaar_test") {
    throw new Error("Commerce fixtures require the disposable stabilization database.");
  }

  const prefix = `stabilization-${randomUUID()}`;
  const password = options.password ?? `Synthetic-${randomUUID()}!`;
  const passwordHash = await bcrypt.hash(password, 10);
  const createTenant = (label: "a" | "b") =>
    db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: `${prefix}-${label}`, plan: "ENTERPRISE", subscriptionStatus: "ACTIVE" },
      });
      const stores = await Promise.all(
        [1, 2].map((number) =>
          tx.store.create({
            data: {
              organizationId: org.id,
              name: `${prefix}-${label}-store-${number}`,
              code: `${label}-${number}`,
            },
          }),
        ),
      );
      const users = {} as Record<Role, User>;
      for (const role of commerceRoles) {
        users[role] = await tx.user.create({
          data: {
            organizationId: org.id,
            name: `Synthetic ${label.toUpperCase()} ${role}`,
            email: `${prefix}.${label}.${role.toLowerCase()}@example.test`,
            passwordHash,
            role,
            isOrgOwner: false,
            emailVerifiedAt: new Date(),
          },
        });
        await tx.userStoreAccess.create({
          data: { organizationId: org.id, userId: users[role].id, storeId: stores[0].id },
        });
      }
      return { org, stores, users };
    });

  const a = await createTenant("a");
  const b = await createTenant("b");
  return { prefix, password, tenants: { a, b } };
}

export type CommerceFixtures = Awaited<ReturnType<typeof createCommerceFixtures>>;

/** A fresh caller context checks database-backed store grants on every procedure invocation. */
export function commerceContext(db: PrismaClient, user: User | null): Context {
  if (user && !user.organizationId)
    throw new Error("Synthetic commerce user needs an organization.");
  const requestId = randomUUID();
  return {
    prisma: db,
    user: user
      ? {
          id: user.id,
          email: user.email,
          organizationId: user.organizationId!,
          role: user.role,
          isOrgOwner: user.isOrgOwner,
          isPlatformOwner: false,
        }
      : null,
    impersonator: null,
    impersonationSessionId: null,
    ip: null,
    requestId,
    logger: getLogger(requestId),
  };
}

/** Only this fixture's metadata is removed. Unexpected dependencies fail rather than being erased. */
export async function cleanupCommerceFixtures(db: PrismaClient, fixture: CommerceFixtures) {
  assertStabilizationDatabase();
  if (!fixture.prefix.startsWith("stabilization-")) throw new Error("Unrecognized fixture owner.");
  const organizationIds = [fixture.tenants.a.org.id, fixture.tenants.b.org.id];
  const existing = await db.organization.findMany({ where: { id: { in: organizationIds } } });
  if (existing.some((org) => !org.name.startsWith(fixture.prefix))) {
    throw new Error("Refusing to clean an organization not owned by this fixture.");
  }
  const where = { organizationId: { in: organizationIds } };
  await db.$transaction(async (tx) => {
    await tx.customer.deleteMany({ where });
    await tx.supplier.deleteMany({ where });
    await tx.auditLog.deleteMany({ where });
    await tx.userStoreAccess.deleteMany({ where });
    await tx.user.deleteMany({ where });
    await tx.store.deleteMany({ where });
    await tx.productCatalog.deleteMany({ where });
    await tx.organization.deleteMany({ where: { id: { in: organizationIds } } });
  });
}
