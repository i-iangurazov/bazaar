import { randomUUID } from "node:crypto";
import { Role } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { prisma } from "@/server/db/prisma";
import { customersRouter } from "@/server/trpc/routers/customers";
import { suppliersRouter } from "@/server/trpc/routers/suppliers";
import { storesRouter } from "@/server/trpc/routers/stores";
import {
  cleanupCommerceFixtures,
  commerceContext,
  commerceRoles,
  createCommerceFixtures,
  type CommerceFixtures,
} from "./fixtures";

// No aggregate appRouter, auth/DB mocks, inventory models or provider operations are used.
// Customer detail's successful order-history branch is deliberately not executed.
describe("persisted commerce metadata and access boundaries", () => {
  let fixture: CommerceFixtures;

  beforeEach(async () => {
    fixture = await createCommerceFixtures(prisma);
  });
  afterEach(async () => {
    if (fixture) await cleanupCommerceFixtures(prisma, fixture);
  });

  const callers = (role: Role = Role.ADMIN, tenant: "a" | "b" = "a") => {
    const user = fixture.tenants[tenant].users[role];
    return {
      customers: customersRouter.createCaller(commerceContext(prisma, user)),
      suppliers: suppliersRouter.createCaller(commerceContext(prisma, user)),
      stores: storesRouter.createCaller(commerceContext(prisma, user)),
    };
  };
  const customerInput = (storeId = fixture.tenants.a.stores[0].id) => ({
    storeId,
    name: `Synthetic customer ${randomUUID()}`,
    email: `${randomUUID()}@example.test`,
    address: "Synthetic address",
  });
  const supplierInput = () => ({
    name: `Synthetic supplier ${randomUUID()}`,
    email: `${randomUUID()}@example.test`,
    notes: "Synthetic metadata only",
  });
  const customerRow = (id: string) => prisma.customer.findUniqueOrThrow({ where: { id } });
  const auditCount = () =>
    prisma.auditLog.count({ where: { organizationId: fixture.tenants.a.org.id } });

  test("anonymous callers cannot access commerce lists or create metadata", async () => {
    const context = commerceContext(prisma, null);
    const customers = customersRouter.createCaller(context);
    const suppliers = suppliersRouter.createCaller(context);
    await expect(storesRouter.createCaller(context).list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(customers.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(suppliers.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(customers.create(customerInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(suppliers.create(supplierInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await auditCount()).toBe(0);
  });

  test("customer export rows match the selected store and persisted search results", async () => {
    const visible = await callers().customers.create(customerInput());
    const hidden = await callers().customers.create(customerInput(fixture.tenants.a.stores[1].id));
    const restricted = callers(Role.MANAGER).customers;
    const filter = { storeId: visible.customer.storeId, search: visible.customer.email! };
    const page = await restricted.list(filter);
    const rows = await restricted.exportRows(filter);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: page.items[0].name, email: visible.customer.email });
    expect(rows.some((row) => row.email === hidden.customer.email)).toBe(false);
    const secondStoreRows = await callers().customers.exportRows({
      storeId: hidden.customer.storeId,
    });
    expect(secondStoreRows.map((row) => row.email)).toEqual([hidden.customer.email]);
    // Export row retrieval is verified; file encoding/download and print layout are not implied.
  });

  test.each([Role.ADMIN, Role.MANAGER])(
    "%s persists customer create/update/archive across fresh callers",
    async (role) => {
      const input = customerInput();
      const created = await callers(role).customers.create(input);
      expect(created.action).toBe("created");
      expect(await customerRow(created.customer.id)).toMatchObject({
        ...input,
        organizationId: fixture.tenants.a.org.id,
      });
      const renamed = `${input.name} updated`;
      await callers(role).customers.update({
        customerId: created.customer.id,
        name: renamed,
        email: input.email,
      });
      const refreshed = await callers(role).customers.list({
        storeId: input.storeId,
        search: input.email,
      });
      expect(refreshed.items.map((row) => row.id)).toEqual([created.customer.id]);
      expect(refreshed.items[0].name).toBe(renamed);
      await callers(role).customers.delete({ customerId: created.customer.id });
      expect((await customerRow(created.customer.id)).deletedAt).toBeInstanceOf(Date);
      expect(
        (await callers(role).customers.list({ storeId: input.storeId, search: input.email })).total,
      ).toBe(0);
      expect(
        await prisma.auditLog.findMany({
          where: { entityId: created.customer.id },
          select: { action: true },
        }),
      ).toEqual(
        expect.arrayContaining([
          { action: "CUSTOMER_UPSERT" },
          { action: "CUSTOMER_UPDATE" },
          { action: "CUSTOMER_ARCHIVE" },
        ]),
      );
    },
  );

  test.each([Role.ADMIN, Role.MANAGER])(
    "%s persists supplier create/update/delete across fresh callers",
    async (role) => {
      const created = await callers(role).suppliers.create(supplierInput());
      const update = {
        supplierId: created.id,
        name: `${created.name} updated`,
        email: created.email!,
        notes: "Updated synthetic notes",
      };
      await callers(role).suppliers.update(update);
      const refreshed = await callers(role).suppliers.listPage({
        search: created.email!,
        page: 1,
        pageSize: 10,
      });
      expect(refreshed.items).toHaveLength(1);
      expect(refreshed.items[0]).toMatchObject({
        id: created.id,
        name: update.name,
        notes: update.notes,
      });
      expect(await prisma.supplier.findUnique({ where: { id: created.id } })).toMatchObject({
        name: update.name,
      });
      await callers(role).suppliers.delete({ supplierId: created.id });
      expect(await prisma.supplier.findUnique({ where: { id: created.id } })).toBeNull();
      expect((await callers(role).suppliers.list()).some((row) => row.id === created.id)).toBe(
        false,
      );
    },
  );

  test("customer invalid create/update and duplicate rejection leave persisted rows and audit unchanged", async () => {
    const first = await callers().customers.create(customerInput());
    const second = await callers().customers.create(customerInput());
    const before = await customerRow(first.customer.id);
    const audits = await auditCount();
    await expect(
      callers().customers.create({ ...customerInput(), email: "invalid-email" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      callers().customers.create({ storeId: before.storeId, name: "Missing contact" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      callers().customers.update({ customerId: before.id, name: "", email: before.email }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      callers().customers.update({
        customerId: before.id,
        name: "Should not persist",
        email: second.customer.email,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await customerRow(before.id)).toEqual(before);
    expect(
      await prisma.customer.count({ where: { organizationId: fixture.tenants.a.org.id } }),
    ).toBe(2);
    expect(await auditCount()).toBe(audits);
  });

  test("supplier validation rejects invalid metadata without partial persistence", async () => {
    const created = await callers().suppliers.create(supplierInput());
    const audits = await auditCount();
    await expect(callers().suppliers.create({ name: "x", email: "bad" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      callers().suppliers.update({ supplierId: created.id, name: "Changed", email: "bad" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await prisma.supplier.findUnique({ where: { id: created.id } })).toEqual(created);
    expect(
      await prisma.supplier.count({ where: { organizationId: fixture.tenants.a.org.id } }),
    ).toBe(1);
    expect(await auditCount()).toBe(audits);
  });

  test("customer identifiers and explicit store filters cannot cross organizations", async () => {
    const foreign = await callers(Role.ADMIN, "b").customers.create(
      customerInput(fixture.tenants.b.stores[0].id),
    );
    const before = await customerRow(foreign.customer.id);
    const local = callers();
    await expect(local.customers.create(customerInput(before.storeId))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(local.customers.list({ storeId: before.storeId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(local.customers.detail({ customerId: before.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      local.customers.update({ customerId: before.id, name: "Tampered", email: before.email }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(local.customers.delete({ customerId: before.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await local.customers.list()).items).toEqual([]);
    expect(await customerRow(before.id)).toEqual(before);
  });

  test("manager customer reads and mutations cannot reach an unassigned same-organization store", async () => {
    const hidden = await callers().customers.create(customerInput(fixture.tenants.a.stores[1].id));
    const before = await customerRow(hidden.customer.id);
    const restricted = callers(Role.MANAGER).customers;
    await expect(restricted.list({ storeId: before.storeId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(restricted.exportRows({ storeId: before.storeId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(restricted.detail({ customerId: before.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(restricted.create(customerInput(before.storeId))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      restricted.update({ customerId: before.id, name: "Tampered", email: before.email }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(restricted.delete({ customerId: before.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await restricted.list()).items).toEqual([]);
    expect(await customerRow(before.id)).toEqual(before);
  });

  test("supplier organization isolation also makes mixed-organization bulk deletion atomic", async () => {
    const own = await callers().suppliers.create(supplierInput());
    const foreign = await callers(Role.ADMIN, "b").suppliers.create(supplierInput());
    const local = callers().suppliers;
    expect((await local.list()).map((row) => row.id)).toEqual([own.id]);
    expect((await local.listPage({ search: foreign.name, page: 1, pageSize: 10 })).total).toBe(0);
    await expect(local.update({ supplierId: foreign.id, name: "Tampered" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(local.delete({ supplierId: foreign.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(local.bulkDelete({ supplierIds: [own.id, foreign.id] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await prisma.supplier.findUnique({ where: { id: own.id } })).toEqual(own);
    expect(await prisma.supplier.findUnique({ where: { id: foreign.id } })).toEqual(foreign);
  });

  test.each(commerceRoles)(
    "%s has the documented commerce role and store-list permissions",
    async (role) => {
      const current = callers(role);
      const canManage = role === Role.ADMIN || role === Role.MANAGER;
      const store = fixture.tenants.a.stores[0];
      expect((await current.stores.list()).map((row) => row.id).sort()).toEqual(
        (role === Role.ADMIN ? fixture.tenants.a.stores.map((row) => row.id) : [store.id]).sort(),
      );
      if (canManage) {
        await expect(current.customers.list({ storeId: store.id })).resolves.toMatchObject({
          total: 0,
        });
        await expect(current.suppliers.list()).resolves.toEqual([]);
        await expect(
          current.stores.update({
            storeId: store.id,
            name: `${store.name} changed`,
            code: store.code,
          }),
        ).resolves.toMatchObject({ id: store.id });
      } else {
        await expect(current.customers.list({ storeId: store.id })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(current.customers.create(customerInput())).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(current.suppliers.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(current.suppliers.create(supplierInput())).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(
          current.stores.update({ storeId: store.id, name: "Denied", code: store.code }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(await prisma.store.findUnique({ where: { id: store.id } })).toEqual(store);
      }
    },
  );

  test("revoking a manager's store grant takes effect for an already-created caller", async () => {
    const created = await callers(Role.MANAGER).customers.create(customerInput());
    const restricted = callers(Role.MANAGER);
    await prisma.userStoreAccess.deleteMany({
      where: { userId: fixture.tenants.a.users.MANAGER.id },
    });
    expect(await restricted.stores.list()).toEqual([]);
    expect((await restricted.customers.list({ storeId: created.customer.storeId })).items).toEqual(
      [],
    );
    await expect(restricted.customers.create(customerInput())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      restricted.customers.update({
        customerId: created.customer.id,
        name: "Denied",
        email: created.customer.email,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      restricted.customers.delete({ customerId: created.customer.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await customerRow(created.customer.id)).deletedAt).toBeNull();
  });

  test("store metadata create/update persists without clone, shared catalog or stock initialization", async () => {
    const created = await callers().stores.create({
      name: `${fixture.prefix}-new-store`,
      code: "metadata-new",
      allowNegativeStock: false,
      trackExpiryLots: false,
    });
    expect(created.cloneSummary).toBeNull();
    expect((await callers().stores.list()).some((row) => row.id === created.id)).toBe(true);
    await callers().stores.update({
      storeId: created.id,
      name: "Updated synthetic store",
      code: "metadata-updated",
    });
    expect((await callers().stores.list()).find((row) => row.id === created.id)).toMatchObject({
      name: "Updated synthetic store",
      code: "metadata-updated",
    });
    expect(await prisma.store.findUnique({ where: { id: created.id } })).toMatchObject({
      name: "Updated synthetic store",
      code: "metadata-updated",
    });
    // There is no store delete router procedure; fixture teardown is not credited as application CRUD.
  });

  test("store duplicate-code rejection rolls back the newly created default catalog and audit", async () => {
    const catalogCount = await prisma.productCatalog.count({
      where: { organizationId: fixture.tenants.a.org.id },
    });
    const audits = await auditCount();
    await expect(
      callers().stores.create({
        name: "Duplicate synthetic store",
        code: fixture.tenants.a.stores[0].code,
        allowNegativeStock: false,
        trackExpiryLots: false,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await prisma.productCatalog.count({ where: { organizationId: fixture.tenants.a.org.id } }),
    ).toBe(catalogCount);
    expect(await prisma.store.count({ where: { organizationId: fixture.tenants.a.org.id } })).toBe(
      2,
    );
    expect(await auditCount()).toBe(audits);
  });

  test("store metadata update rejects a foreign organization identifier", async () => {
    const foreign = fixture.tenants.b.stores[0];
    await expect(
      callers().stores.update({ storeId: foreign.id, name: "Tampered", code: foreign.code }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.store.findUnique({ where: { id: foreign.id } })).toEqual(foreign);
  });

  // docs/store-access-model.md: managers have only explicit store grants; no metadata exception.
  test("store metadata update rejects a manager's unassigned same-organization store", async () => {
    const hidden = fixture.tenants.a.stores[1];
    await expect(
      callers(Role.MANAGER).stores.update({
        storeId: hidden.id,
        name: "Tampered",
        code: hidden.code,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.store.findUnique({ where: { id: hidden.id } })).toEqual(hidden);
  });

  test("store metadata update rejects an already-created caller after grant revocation", async () => {
    const store = fixture.tenants.a.stores[0];
    const restricted = callers(Role.MANAGER).stores;
    await prisma.userStoreAccess.deleteMany({
      where: { userId: fixture.tenants.a.users.MANAGER.id },
    });
    await expect(
      restricted.update({ storeId: store.id, name: "Tampered after revocation", code: store.code }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.store.findUnique({ where: { id: store.id } })).toEqual(store);
  });
});
