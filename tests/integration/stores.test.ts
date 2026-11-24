import { beforeEach, describe, expect, it } from "vitest";
import { LegalEntityType, PrinterPrintMode } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("stores", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("grants a manager access only to the store they create", async () => {
    const { org, store, managerUser, staffUser } = await seedBase({ plan: "BUSINESS" });
    const manager = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });
    const staff = createTestCaller({
      id: staffUser.id,
      email: staffUser.email,
      role: staffUser.role,
      organizationId: org.id,
    });

    const created = await manager.stores.create({
      name: "Manager's new store",
      code: "MANAGER-NEW",
      allowNegativeStock: false,
      trackExpiryLots: false,
      cloneFromStoreId: store.id,
    });

    expect(created.cloneSummary).toMatchObject({
      sourceStoreId: store.id,
      storeProducts: 1,
      inventorySnapshots: 0,
    });
    expect(await prisma.userStoreAccess.findMany({
      where: { organizationId: org.id, storeId: created.id },
      select: { userId: true },
    })).toEqual([{ userId: managerUser.id }]);
    expect((await manager.stores.list()).map((shop) => shop.id)).toEqual(
      expect.arrayContaining([store.id, created.id]),
    );
    expect((await manager.products.listContext({ storeId: created.id })).selectedStoreId).toBe(created.id);
    expect((await staff.products.listContext()).stores.map((shop) => shop.id)).toEqual([store.id]);
  });

  it("shows an administrator-created store to a manager after explicit assignment", async () => {
    const { org, store, adminUser, managerUser } = await seedBase({ plan: "BUSINESS" });
    const administrator = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });
    const manager = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    const created = await administrator.stores.create({
      name: "Administrator's new store",
      code: "ADMIN-NEW",
      allowNegativeStock: false,
      trackExpiryLots: false,
    });
    expect(await prisma.userStoreAccess.count({ where: { storeId: created.id } })).toBe(0);
    expect((await manager.stores.list()).map((shop) => shop.id)).toEqual([store.id]);

    await administrator.users.update({
      userId: managerUser.id,
      name: managerUser.name,
      email: managerUser.email,
      role: managerUser.role,
      preferredLocale: "ru",
      storeIds: [store.id, created.id],
    });

    expect((await manager.products.listContext({ storeId: created.id })).selectedStoreId).toBe(created.id);
  });

  it("rejects cloning a store outside the manager's assignments without creating a store or grant", async () => {
    const { org, managerUser } = await seedBase({ plan: "BUSINESS" });
    const unassigned = await prisma.store.create({
      data: { organizationId: org.id, name: "Unassigned store", code: "UNASSIGNED" },
    });
    const manager = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    await expect(manager.stores.create({
      name: "Rejected copy",
      code: "DENIED-COPY",
      allowNegativeStock: false,
      trackExpiryLots: false,
      cloneFromStoreId: unassigned.id,
    })).rejects.toMatchObject({ code: "FORBIDDEN", message: "storeAccessDenied" });

    expect(await prisma.store.count({ where: { organizationId: org.id } })).toBe(2);
    expect(await prisma.productCatalog.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await prisma.userStoreAccess.count({ where: { userId: managerUser.id } })).toBe(1);
  });

  it.each([
    { status: "inactive", data: { isActive: false } },
    { status: "deleted", data: { deletedAt: new Date("2026-01-01T00:00:00Z") } },
    { status: "demoted", data: { role: "STAFF" as const } },
  ])("rejects creation with an $status manager", async ({ data }) => {
    const { org, managerUser } = await seedBase({ plan: "BUSINESS" });
    const manager = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });
    await prisma.user.update({ where: { id: managerUser.id }, data });

    await expect(manager.stores.create({
      name: "Denied store",
      code: "DENIED",
      allowNegativeStock: false,
      trackExpiryLots: false,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.store.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("updates legal details for admin", async () => {
    const { org, store, adminUser } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const updated = await caller.stores.updateLegalDetails({
      storeId: store.id,
      legalEntityType: LegalEntityType.IP,
      legalName: "IP Test",
      inn: "1234567890",
      address: "Bishkek",
      phone: "+996700000000",
    });

    expect(updated).toMatchObject({
      id: store.id,
      legalEntityType: LegalEntityType.IP,
      legalName: "IP Test",
      inn: "1234567890",
    });

    const stored = await prisma.store.findUnique({ where: { id: store.id } });
    expect(stored?.legalEntityType).toBe(LegalEntityType.IP);
    expect(stored?.inn).toBe("1234567890");
  });

  it("forbids staff updates", async () => {
    const { org, store, staffUser } = await seedBase();
    const caller = createTestCaller({
      id: staffUser.id,
      email: staffUser.email,
      role: staffUser.role,
      organizationId: org.id,
    });

    await expect(
      caller.stores.updateLegalDetails({
        storeId: store.id,
        legalEntityType: LegalEntityType.OSOO,
        legalName: "Test LLC",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("saves and returns the default barcode label print profile", async () => {
    const { org, store, managerUser } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    const updated = await caller.stores.updateHardware({
      storeId: store.id,
      receiptPrintMode: PrinterPrintMode.PDF,
      labelPrintMode: PrinterPrintMode.PDF,
      receiptPrinterModel: "XP-P501A",
      labelPrinterModel: "XP-365B",
      labelTemplate: "2x5",
      labelPaperMode: "A4",
      labelBarcodeType: "code128",
      labelDefaultCopies: 3,
      labelShowProductName: true,
      labelShowPrice: false,
      labelShowSku: true,
      labelShowStoreName: true,
      labelRollGapMm: 4,
      labelRollXOffsetMm: 1,
      labelRollYOffsetMm: -1,
      labelWidthMm: 60,
      labelHeightMm: 45,
      labelMarginTopMm: 2,
      labelMarginRightMm: 3,
      labelMarginBottomMm: 4,
      labelMarginLeftMm: 5,
    });

    expect(updated).toMatchObject({
      storeId: store.id,
      labelTemplate: "2x5",
      labelPaperMode: "A4",
      labelBarcodeType: "code128",
      labelDefaultCopies: 3,
      labelShowPrice: false,
      labelShowStoreName: true,
      labelWidthMm: 60,
      labelHeightMm: 45,
      labelMarginLeftMm: 5,
    });

    const hardware = await caller.stores.hardware({ storeId: store.id });
    expect(hardware.settings).toMatchObject({
      labelTemplate: "2x5",
      labelPaperMode: "A4",
      labelBarcodeType: "code128",
      labelDefaultCopies: 3,
      labelShowPrice: false,
      labelShowStoreName: true,
      labelRollGapMm: 4,
      labelRollXOffsetMm: 1,
      labelRollYOffsetMm: -1,
    });

    const stored = await prisma.storePrinterSettings.findUnique({ where: { storeId: store.id } });
    expect(stored?.labelTemplate).toBe("2x5");
    expect(stored?.labelDefaultCopies).toBe(3);
  });

  it("lets cashiers configure printing but keeps staff and store administration denied", async () => {
    const { org, store, cashierUser, staffUser } = await seedBase({ plan: "BUSINESS" });
    const cashierCaller = createTestCaller({
      id: cashierUser.id,
      email: cashierUser.email,
      role: cashierUser.role,
      organizationId: org.id,
    });
    const staffCaller = createTestCaller({
      id: staffUser.id,
      email: staffUser.email,
      role: staffUser.role,
      organizationId: org.id,
    });

    const updated = await cashierCaller.stores.updateHardware({
      storeId: store.id,
      receiptPrintMode: PrinterPrintMode.PDF,
      labelPrintMode: PrinterPrintMode.PDF,
      receiptPrintProvider: "MANUAL_BROWSER_PRINT",
      receiptPaperSize: "80MM",
    });

    expect(updated).toMatchObject({
      storeId: store.id,
      receiptPrintProvider: "MANUAL_BROWSER_PRINT",
      receiptPaperSize: "80MM",
    });
    await expect(
      staffCaller.stores.updateHardware({
        storeId: store.id,
        receiptPrintMode: PrinterPrintMode.PDF,
        labelPrintMode: PrinterPrintMode.PDF,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      cashierCaller.stores.updateLegalDetails({
        storeId: store.id,
        legalEntityType: LegalEntityType.OSOO,
        legalName: "Forbidden cashier update",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
