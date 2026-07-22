import { CustomerOrderSource } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import {
  createBazaarApiOrder,
  getBazaarApiOrder,
  listBazaarApiOrders,
} from "@/server/services/bazaarApi";
import { formatBazaarExternalOrderIdNote } from "@/server/services/bazaarExternalIdentity";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
const legacyMarkerFlag = "BAZAAR_API_WRITE_LEGACY_EXTERNAL_ID_MARKER";
const initialLegacyMarkerFlag = process.env[legacyMarkerFlag];

const seedIndependentCatalog = async () => {
  const organization = await prisma.organization.create({ data: { name: "Scope Org 2" } });
  const unit = await prisma.unit.create({
    data: {
      organizationId: organization.id,
      code: "each",
      labelRu: "each",
      labelKg: "each",
    },
  });
  const store = await prisma.store.create({
    data: {
      organizationId: organization.id,
      name: "Scope Store 2",
      code: "SCP2",
    },
  });
  const supplier = await prisma.supplier.create({
    data: { organizationId: organization.id, name: "Scope Supplier 2" },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: organization.id,
      supplierId: supplier.id,
      sku: "SCOPE-PRODUCT-2",
      name: "Scope Product 2",
      unit: unit.code,
      baseUnitId: unit.id,
      basePriceKgs: 100,
    },
  });
  await prisma.storeProduct.create({
    data: {
      organizationId: organization.id,
      storeId: store.id,
      productId: product.id,
      isActive: true,
    },
  });
  return { organization, store, product };
};

describeDb("Bazaar API exact external identity", () => {
  beforeEach(async () => {
    await resetDatabase();
    delete process.env[legacyMarkerFlag];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (initialLegacyMarkerFlag === undefined) {
      delete process.env[legacyMarkerFlag];
    } else {
      process.env[legacyMarkerFlag] = initialLegacyMarkerFlag;
    }
  });

  it("keeps prefix, spacing, and case variants distinct and dual-writes by default", async () => {
    const { org, store, product } = await seedBase();
    const identities = ["EXT-10", "EXT-1", "A  B", "A B", "Case-ID", "case-id"];
    const created = [];
    for (const externalId of identities) {
      created.push(
        await createBazaarApiOrder({
          organizationId: org.id,
          storeId: store.id,
          externalId,
          lines: [{ productId: product.id, qty: 1 }],
        }),
      );
    }

    expect(new Set(created.map((order) => order.id))).toHaveLength(identities.length);
    const rows = await prisma.customerOrder.findMany({
      where: { organizationId: org.id, storeId: store.id, source: CustomerOrderSource.API },
      select: { id: true, externalOrderId: true, notes: true },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((row) => row.externalOrderId)).toEqual(identities);
    expect(rows.map((row) => row.notes)).toEqual(identities.map(formatBazaarExternalOrderIdNote));

    const exact = await getBazaarApiOrder({
      organizationId: org.id,
      storeId: store.id,
      identifier: "EXT-1",
    });
    const listed = await listBazaarApiOrders({
      organizationId: org.id,
      storeId: store.id,
      externalOrderId: "EXT-1",
    });
    expect(exact.id).toBe(created[1]?.id);
    expect(exact.externalOrderId).toBe("EXT-1");
    expect(listed.data.map((order) => order.id)).toEqual([created[1]?.id]);
  });

  it("reads the exact field first and falls back only to a strict legacy marker", async () => {
    const { org, store, product } = await seedBase();
    const legacyLong = await createBazaarApiOrder({
      organizationId: org.id,
      storeId: store.id,
      externalId: "LEGACY-10",
      lines: [{ productId: product.id, qty: 1 }],
    });
    const legacyShort = await createBazaarApiOrder({
      organizationId: org.id,
      storeId: store.id,
      externalId: "LEGACY-1",
      lines: [{ productId: product.id, qty: 1 }],
    });
    await prisma.customerOrder.updateMany({
      where: { id: { in: [legacyLong.id, legacyShort.id] } },
      data: { externalOrderId: null },
    });

    const foundLegacy = await getBazaarApiOrder({
      organizationId: org.id,
      storeId: store.id,
      identifier: "LEGACY-1",
    });
    expect(foundLegacy).toMatchObject({ id: legacyShort.id, externalOrderId: "LEGACY-1" });
    await expect(
      listBazaarApiOrders({
        organizationId: org.id,
        storeId: store.id,
        externalOrderId: "LEGACY-1",
      }),
    ).resolves.toMatchObject({ data: [{ id: legacyShort.id, externalOrderId: "LEGACY-1" }] });

    const exact = await createBazaarApiOrder({
      organizationId: org.id,
      storeId: store.id,
      externalId: "FIELD-FIRST",
      lines: [{ productId: product.id, qty: 1 }],
    });
    await prisma.customerOrder.update({
      where: { id: exact.id },
      data: { notes: "Bazaar API externalId: DIFFERENT-LEGACY" },
    });
    await expect(
      getBazaarApiOrder({
        organizationId: org.id,
        storeId: store.id,
        identifier: "FIELD-FIRST",
      }),
    ).resolves.toMatchObject({ id: exact.id, externalOrderId: "FIELD-FIRST" });

    await prisma.customerOrder.update({
      where: { id: legacyShort.id },
      data: { notes: " Bazaar API externalId: LEGACY-1 " },
    });
    await expect(
      getBazaarApiOrder({
        organizationId: org.id,
        storeId: store.id,
        identifier: "LEGACY-1",
      }),
    ).rejects.toMatchObject({ message: "orderNotFound" });

    await prisma.customerOrder.updateMany({
      where: { id: { in: [legacyLong.id, legacyShort.id] } },
      data: {
        externalOrderId: null,
        notes: "Bazaar API externalId: DUPLICATE-LEGACY",
      },
    });
    await expect(
      getBazaarApiOrder({
        organizationId: org.id,
        storeId: store.id,
        identifier: "DUPLICATE-LEGACY",
      }),
    ).rejects.toMatchObject({ message: "externalOrderIdConflict" });
  });

  it("allows the same identity across stores and organizations but replays within one scope", async () => {
    const { org, store, product } = await seedBase();
    const secondStore = await prisma.store.create({
      data: { organizationId: org.id, name: "Second Store", code: "TST2" },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: secondStore.id,
        productId: product.id,
        isActive: true,
      },
    });
    const independent = await seedIndependentCatalog();
    const sharedExternalId = "SHARED-SCOPE-ID";

    const first = await createBazaarApiOrder({
      organizationId: org.id,
      storeId: store.id,
      externalId: sharedExternalId,
      lines: [{ productId: product.id, qty: 1 }],
    });
    const sameScopeReplay = await createBazaarApiOrder({
      organizationId: org.id,
      storeId: store.id,
      externalId: sharedExternalId,
      lines: [{ productId: product.id, qty: 1 }],
    });
    const secondStoreOrder = await createBazaarApiOrder({
      organizationId: org.id,
      storeId: secondStore.id,
      externalId: sharedExternalId,
      lines: [{ productId: product.id, qty: 1 }],
    });
    const secondOrgOrder = await createBazaarApiOrder({
      organizationId: independent.organization.id,
      storeId: independent.store.id,
      externalId: sharedExternalId,
      lines: [{ productId: independent.product.id, qty: 1 }],
    });

    expect(sameScopeReplay.id).toBe(first.id);
    expect(secondStoreOrder.id).not.toBe(first.id);
    expect(secondOrgOrder.id).not.toBe(first.id);
    await expect(
      prisma.customerOrder.count({
        where: { source: CustomerOrderSource.API, externalOrderId: sharedExternalId },
      }),
    ).resolves.toBe(3);
    await expect(
      prisma.customerOrder.count({
        where: {
          organizationId: org.id,
          storeId: store.id,
          source: CustomerOrderSource.API,
          externalOrderId: sharedExternalId,
        },
      }),
    ).resolves.toBe(1);
  });

  it("can disable only the legacy marker write while retaining exact identity", async () => {
    vi.stubEnv(legacyMarkerFlag, "0");
    const { org, store, product } = await seedBase();
    const created = await createBazaarApiOrder({
      organizationId: org.id,
      storeId: store.id,
      externalId: "EXACT-ONLY",
      comment: "customer-visible note",
      lines: [{ productId: product.id, qty: 1 }],
    });
    await expect(
      prisma.customerOrder.findUniqueOrThrow({
        where: { id: created.id },
        select: { externalOrderId: true, notes: true },
      }),
    ).resolves.toEqual({
      externalOrderId: "EXACT-ONLY",
      notes: "customer-visible note",
    });
  });
});
