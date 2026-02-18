import { beforeEach, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";

import { prisma } from "@/server/db/prisma";

import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("tax references", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("blocks ETTN/ESF upsert when modules are disabled", async () => {
    const { org, store, managerUser } = await seedBase();

    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });

    await expect(
      caller.taxReferences.ettn.upsert({
        storeId: store.id,
        documentType: "PURCHASE",
        documentId: "PO-1",
        ettnNumber: "ETTN-1",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      caller.taxReferences.esf.upsert({
        storeId: store.id,
        documentType: "SALE",
        documentId: "SO-1",
        esfNumber: "ESF-1",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows ETTN/ESF upsert when enabled and keeps list org-scoped", async () => {
    const { org, store, managerUser } = await seedBase();

    await prisma.storeComplianceProfile.upsert({
      where: { storeId: store.id },
      create: {
        organizationId: org.id,
        storeId: store.id,
        enableEttn: true,
        enableEsf: true,
      },
      update: {
        enableEttn: true,
        enableEsf: true,
      },
    });

    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
      isOrgOwner: false,
    });

    const ettn = await caller.taxReferences.ettn.upsert({
      storeId: store.id,
      documentType: "PURCHASE",
      documentId: "PO-100",
      ettnNumber: "ETTN-100",
    });
    const esf = await caller.taxReferences.esf.upsert({
      storeId: store.id,
      documentType: "SALE",
      documentId: "SO-100",
      esfNumber: "ESF-100",
      counterpartyName: "Counterparty",
    });

    const foreignOrg = await prisma.organization.create({
      data: {
        name: "Foreign Org",
        plan: "STARTER",
      },
    });
    const foreignStore = await prisma.store.create({
      data: {
        organizationId: foreignOrg.id,
        name: "Foreign Store",
        code: "FST",
      },
    });
    const foreignUser = await prisma.user.create({
      data: {
        organizationId: foreignOrg.id,
        email: "foreign-admin@test.local",
        name: "Foreign Admin",
        passwordHash: "hash",
        role: Role.ADMIN,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.ettnReference.create({
      data: {
        organizationId: foreignOrg.id,
        storeId: foreignStore.id,
        documentType: "PURCHASE",
        documentId: "PO-999",
        ettnNumber: "ETTN-999",
        createdById: foreignUser.id,
      },
    });
    await prisma.esfReference.create({
      data: {
        organizationId: foreignOrg.id,
        storeId: foreignStore.id,
        documentType: "SALE",
        documentId: "SO-999",
        esfNumber: "ESF-999",
        createdById: foreignUser.id,
      },
    });

    const ettnList = await caller.taxReferences.ettn.list({
      storeId: store.id,
      page: 1,
      pageSize: 25,
    });
    const esfList = await caller.taxReferences.esf.list({
      storeId: store.id,
      page: 1,
      pageSize: 25,
    });

    expect(ettn.id).toBeTruthy();
    expect(esf.id).toBeTruthy();
    expect(ettnList.total).toBe(1);
    expect(esfList.total).toBe(1);
    expect(ettnList.items[0]?.documentId).toBe("PO-100");
    expect(esfList.items[0]?.documentId).toBe("SO-100");
  });
});
