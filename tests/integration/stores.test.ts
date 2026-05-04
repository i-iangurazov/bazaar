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
});
