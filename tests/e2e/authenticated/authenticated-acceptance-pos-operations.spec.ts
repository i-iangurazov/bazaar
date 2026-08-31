import {
  CustomerOrderStatus,
  PosPaymentMethod,
  PrismaClient,
  RegisterShiftStatus,
} from "@prisma/client";
import type { Browser, BrowserContext, Locator, Page, TestInfo } from "@playwright/test";

import {
  assertAuthenticatedE2EBaseUrl,
  assertAuthenticatedE2EDatabaseUrl,
  authenticatedE2EAccounts,
  authenticatedE2EPassword,
  authenticatedE2EStorageStatePath,
} from "./contract";
import { authenticatedPosOperationsFixture as fixture } from "./pos-operations-contract";
import {
  assertCleanPosOperationsAudit,
  attachPosOperationsAuditOnFailure,
  expect,
  posOperationsMutationCount,
  test,
  type PosOperationsAudit,
  type PosOperationsMutationProcedure,
} from "./pos-operations-test-fixtures";

const datasourceUrl = assertAuthenticatedE2EDatabaseUrl(process.env.E2E_AUTH_DATABASE_URL);
const prisma = new PrismaClient({ datasourceUrl });
const mobileViewport = { width: 390, height: 844 } as const;
const desktopViewport = { width: 1440, height: 900 } as const;

const gotoDirect = async (page: Page, path: string) => {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `${path} must return a document`).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);
};

const rapidClick = async (locator: Locator) => {
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled();
  await locator.evaluate((node) => {
    const button = node as HTMLButtonElement;
    button.click();
    button.click();
  });
};

const expectMutationTotal = async (
  audit: PosOperationsAudit,
  procedure: PosOperationsMutationProcedure,
  total: number,
) => {
  await expect.poll(() => posOperationsMutationCount(audit, procedure)).toBe(total);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(posOperationsMutationCount(audit, procedure)).toBe(total);
};

const installOwnedIdempotencyKeys = async (
  page: Page,
  prefix: string = fixture.idempotencyKeyPrefix,
) => {
  await page.addInitScript((prefix) => {
    let sequence = 0;
    const createOwnedKey = () => `${prefix}${Date.now()}-${++sequence}`;
    try {
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        configurable: true,
        value: createOwnedKey,
      });
    } catch {
      Object.defineProperty(Crypto.prototype, "randomUUID", {
        configurable: true,
        value: createOwnedKey,
      });
    }
  }, prefix);
};

const seedPaymentCorrectionBrowserFixtures = async () => {
  const paymentFixture = fixture.paymentCorrection;
  const saleIds: string[] = [
    paymentFixture.eligibleReceipt.id,
    paymentFixture.ineligibleReceipt.id,
  ];
  const registerIds: string[] = [
    paymentFixture.eligibleRegister.id,
    paymentFixture.ineligibleRegister.id,
  ];
  const shiftIds: string[] = [paymentFixture.eligibleShiftId, paymentFixture.ineligibleShiftId];
  const cashier = await prisma.user.findFirstOrThrow({
    where: {
      organizationId: fixture.organizationId,
      email: authenticatedE2EAccounts.cashier.email,
      role: "CASHIER",
    },
    select: { id: true },
  });

  const [existingSales, conflictingNumbers, existingRegisters, existingShifts] = await Promise.all([
    prisma.customerOrder.findMany({
      where: { id: { in: saleIds } },
      select: { id: true, organizationId: true, storeId: true, number: true, isPosSale: true },
    }),
    prisma.customerOrder.findMany({
      where: {
        organizationId: fixture.organizationId,
        number: {
          in: [paymentFixture.eligibleReceipt.number, paymentFixture.ineligibleReceipt.number],
        },
      },
      select: { id: true, number: true },
    }),
    prisma.posRegister.findMany({
      where: {
        OR: [
          { id: { in: registerIds } },
          {
            storeId: fixture.storeId,
            code: {
              in: [paymentFixture.eligibleRegister.code, paymentFixture.ineligibleRegister.code],
            },
          },
        ],
      },
      select: { id: true, organizationId: true, storeId: true, code: true },
    }),
    prisma.registerShift.findMany({
      where: { OR: [{ id: { in: shiftIds } }, { registerId: { in: registerIds } }] },
      select: { id: true, organizationId: true, storeId: true, registerId: true },
    }),
  ]);

  for (const sale of [...existingSales, ...conflictingNumbers]) {
    if (
      !saleIds.includes(sale.id) ||
      ("organizationId" in sale && sale.organizationId !== fixture.organizationId) ||
      ("storeId" in sale && sale.storeId !== fixture.storeId) ||
      ("isPosSale" in sale && !sale.isPosSale)
    ) {
      throw new Error(`Refusing to replace non-QA payment-correction receipt ${sale.id}.`);
    }
  }
  for (const register of existingRegisters) {
    if (
      !registerIds.includes(register.id) ||
      register.organizationId !== fixture.organizationId ||
      register.storeId !== fixture.storeId
    ) {
      throw new Error(`Refusing to replace non-QA payment-correction register ${register.id}.`);
    }
  }
  for (const shift of existingShifts) {
    if (
      !shiftIds.includes(shift.id) ||
      shift.organizationId !== fixture.organizationId ||
      shift.storeId !== fixture.storeId ||
      !registerIds.includes(shift.registerId)
    ) {
      throw new Error(`Refusing to replace non-QA payment-correction shift ${shift.id}.`);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.deleteMany({
      where: {
        organizationId: fixture.organizationId,
        entityId: { in: [...saleIds, ...shiftIds] },
      },
    });
    await tx.idempotencyKey.deleteMany({
      where: { key: { startsWith: paymentFixture.idempotencyKeyPrefix } },
    });
    await tx.customerOrder.deleteMany({ where: { id: { in: saleIds } } });
    await tx.registerShift.deleteMany({ where: { id: { in: shiftIds } } });

    await tx.posRegister.upsert({
      where: { id: paymentFixture.eligibleRegister.id },
      create: {
        ...paymentFixture.eligibleRegister,
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        isActive: true,
      },
      update: {
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        name: paymentFixture.eligibleRegister.name,
        code: paymentFixture.eligibleRegister.code,
        isActive: true,
      },
    });
    await tx.posRegister.upsert({
      where: { id: paymentFixture.ineligibleRegister.id },
      create: {
        ...paymentFixture.ineligibleRegister,
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        isActive: true,
      },
      update: {
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        name: paymentFixture.ineligibleRegister.name,
        code: paymentFixture.ineligibleRegister.code,
        isActive: true,
      },
    });

    const openedAt = new Date("2026-08-31T02:00:00.000Z");
    await tx.registerShift.create({
      data: {
        id: paymentFixture.eligibleShiftId,
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        registerId: paymentFixture.eligibleRegister.id,
        status: RegisterShiftStatus.OPEN,
        openedAt,
        openedById: cashier.id,
        openingCashKgs: 0,
        expectedCashKgs: paymentFixture.eligibleReceipt.totalKgs,
        currencyCode: "KGS",
        currencyRateKgsPerUnit: 1,
        notes: "QA-BAZAAR eligible payment-correction fixture",
      },
    });
    await tx.registerShift.create({
      data: {
        id: paymentFixture.ineligibleShiftId,
        organizationId: fixture.organizationId,
        storeId: fixture.storeId,
        registerId: paymentFixture.ineligibleRegister.id,
        status: RegisterShiftStatus.CLOSED,
        openedAt,
        openedById: cashier.id,
        closedAt: new Date("2026-08-31T05:30:00.000Z"),
        closedById: cashier.id,
        openingCashKgs: 0,
        expectedCashKgs: paymentFixture.ineligibleReceipt.totalKgs,
        closingCashCountedKgs: paymentFixture.ineligibleReceipt.totalKgs,
        currencyCode: "KGS",
        currencyRateKgsPerUnit: 1,
        notes: "QA-BAZAAR ineligible payment-correction fixture",
      },
    });

    const createReceipt = async (input: {
      receipt: typeof paymentFixture.eligibleReceipt | typeof paymentFixture.ineligibleReceipt;
      registerId: string;
      shiftId: string;
    }) => {
      await tx.customerOrder.create({
        data: {
          id: input.receipt.id,
          organizationId: fixture.organizationId,
          storeId: fixture.storeId,
          registerId: input.registerId,
          shiftId: input.shiftId,
          number: input.receipt.number,
          status: CustomerOrderStatus.COMPLETED,
          isPosSale: true,
          customerName: `${authenticatedE2EAccounts.cashier.name} fixture customer`,
          subtotalKgs: input.receipt.totalKgs,
          discountKgs: 0,
          totalKgs: input.receipt.totalKgs,
          currencyCode: "KGS",
          currencyRateKgsPerUnit: 1,
          completedAt: new Date(input.receipt.completedAt),
          createdAt: new Date(input.receipt.createdAt),
          createdById: cashier.id,
          updatedById: cashier.id,
          lines: {
            create: {
              id: input.receipt.lineId,
              productId: fixture.product.id,
              variantId: null,
              variantKey: fixture.variantKey,
              qty: 1,
              baseUnitPriceKgs: input.receipt.totalKgs,
              unitPriceKgs: input.receipt.totalKgs,
              lineTotalKgs: input.receipt.totalKgs,
              unitCostKgs: fixture.product.unitCostKgs,
              lineCostTotalKgs: fixture.product.unitCostKgs,
            },
          },
          payments: {
            create: {
              id: input.receipt.paymentId,
              organizationId: fixture.organizationId,
              storeId: fixture.storeId,
              shiftId: input.shiftId,
              method: PosPaymentMethod.CASH,
              amountKgs: input.receipt.totalKgs,
              currencyCode: "KGS",
              currencyRateKgsPerUnit: 1,
              isRefund: false,
              createdAt: new Date(input.receipt.completedAt),
              createdById: cashier.id,
            },
          },
        },
      });
    };

    await createReceipt({
      receipt: paymentFixture.eligibleReceipt,
      registerId: paymentFixture.eligibleRegister.id,
      shiftId: paymentFixture.eligibleShiftId,
    });
    await createReceipt({
      receipt: paymentFixture.ineligibleReceipt,
      registerId: paymentFixture.ineligibleRegister.id,
      shiftId: paymentFixture.ineligibleShiftId,
    });
  });
};

type CashierPaymentBrowserAudit = {
  consoleErrors: string[];
  pageErrors: string[];
  externalRequests: string[];
  correctionMutationRequests: string[];
};

const installCashierPaymentBrowserAudit = async (page: Page, baseOrigin: string) => {
  const audit: CashierPaymentBrowserAudit = {
    consoleErrors: [],
    pageErrors: [],
    externalRequests: [],
    correctionMutationRequests: [],
  };
  page.on("console", (message) => {
    if (message.type() === "error") audit.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => audit.pageErrors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== baseOrigin) {
      audit.externalRequests.push(`${request.method()} ${request.url()}`);
      await route.abort("blockedbyclient");
      return;
    }
    if (
      request.method() === "POST" &&
      decodeURIComponent(url.pathname).includes("pos.sales.correctPayments")
    ) {
      audit.correctionMutationRequests.push(request.url());
    }
    if (request.method() === "POST" && url.pathname === "/api/help/events") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    await route.continue();
  });
  return audit;
};

const createCashierBrowserContext = async (
  browser: Browser,
  baseOrigin: string,
  storageState?: string,
) =>
  browser.newContext({
    baseURL: baseOrigin,
    storageState,
    ignoreHTTPSErrors: true,
    locale: "en-US",
    viewport: desktopViewport,
    serviceWorkers: "block",
    colorScheme: "light",
    reducedMotion: "reduce",
  });

const authenticateCashierContext = async (context: BrowserContext, baseOrigin: string) => {
  const csrfResponse = await context.request.get(`${baseOrigin}/api/auth/csrf`, {
    failOnStatusCode: true,
  });
  const csrf = (await csrfResponse.json()) as { csrfToken?: unknown };
  expect(typeof csrf.csrfToken).toBe("string");
  const callback = await context.request.post(`${baseOrigin}/api/auth/callback/credentials`, {
    form: {
      csrfToken: String(csrf.csrfToken),
      email: authenticatedE2EAccounts.cashier.email,
      password: authenticatedE2EPassword,
      callbackUrl: `${baseOrigin}/pos/history`,
      json: "true",
    },
    failOnStatusCode: false,
    maxRedirects: 0,
  });
  expect([200, 302, 303]).toContain(callback.status());
  await expect
    .poll(async () => {
      const response = await context.request.get(`${baseOrigin}/api/auth/session`);
      if (!response.ok()) return null;
      const session = (await response.json()) as { user?: { email?: string; role?: string } };
      return session.user ?? null;
    })
    .toMatchObject({ email: authenticatedE2EAccounts.cashier.email, role: "CASHIER" });
};

const paymentCorrectionSale = (page: Page, saleId: string) =>
  page.locator(`[data-testid="pos-history-sale"][data-sale-id="${saleId}"]:visible`);

const runCashierPaymentCorrectionJourney = async (input: {
  browser: Browser;
  baseOrigin: string;
  testInfo: TestInfo;
}) => {
  const paymentFixture = fixture.paymentCorrection;
  const eligibleId = paymentFixture.eligibleReceipt.id;
  const cashier = await prisma.user.findFirstOrThrow({
    where: {
      organizationId: fixture.organizationId,
      email: authenticatedE2EAccounts.cashier.email,
      role: "CASHIER",
    },
    select: { id: true },
  });
  const [saleBefore, snapshotBefore, costBefore, stockMovementsBefore, cashMovementsBefore] =
    await Promise.all([
      prisma.customerOrder.findUniqueOrThrow({
        where: { id: eligibleId },
        include: { lines: true, payments: true },
      }),
      prisma.inventorySnapshot.findUniqueOrThrow({
        where: {
          storeId_productId_variantKey: {
            storeId: fixture.storeId,
            productId: fixture.product.id,
            variantKey: fixture.variantKey,
          },
        },
      }),
      prisma.productCost.findUniqueOrThrow({
        where: {
          organizationId_productId_variantKey: {
            organizationId: fixture.organizationId,
            productId: fixture.product.id,
            variantKey: fixture.variantKey,
          },
        },
      }),
      prisma.stockMovement.findMany({
        where: { storeId: fixture.storeId, productId: fixture.product.id },
        orderBy: { id: "asc" },
      }),
      prisma.cashDrawerMovement.findMany({
        where: { shiftId: paymentFixture.eligibleShiftId },
        orderBy: { id: "asc" },
      }),
    ]);

  const primaryContext = await createCashierBrowserContext(
    input.browser,
    input.baseOrigin,
    authenticatedE2EStorageStatePath("cashier"),
  );
  const primaryPage = await primaryContext.newPage();
  await installOwnedIdempotencyKeys(primaryPage, paymentFixture.idempotencyKeyPrefix);
  const primaryAudit = await installCashierPaymentBrowserAudit(primaryPage, input.baseOrigin);
  let historyCompletedAt = "";
  try {
    await primaryPage.setViewportSize(desktopViewport);
    await gotoDirect(
      primaryPage,
      `/pos/history?registerId=${encodeURIComponent(paymentFixture.eligibleRegister.id)}`,
    );
    await expect(primaryPage.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
    const eligibleSale = paymentCorrectionSale(primaryPage, eligibleId);
    await expect(eligibleSale).toContainText(paymentFixture.eligibleReceipt.number);
    await expect(eligibleSale).toContainText("4,100.00");
    historyCompletedAt =
      (await eligibleSale.getByTestId("pos-history-occurred-at").textContent())?.trim() ?? "";
    expect(historyCompletedAt).not.toBe("");

    await eligibleSale.getByRole("button", { name: "Correct payment", exact: true }).click();
    const correctionDialog = primaryPage.getByRole("dialog", { name: "Correct payment" });
    await expect(correctionDialog).toBeVisible();
    await expect(correctionDialog).toContainText(paymentFixture.eligibleReceipt.number);
    await expect(correctionDialog.getByTestId("pos-payment-correction-completed-at")).toHaveText(
      historyCompletedAt,
    );
    const paymentMethod = correctionDialog.getByRole("combobox", {
      name: "Payment method 1",
      exact: true,
    });
    await expect(paymentMethod).toContainText("Cash");
    await paymentMethod.click();
    await primaryPage.getByRole("option", { name: "Transfer", exact: true }).click();
    await expect(paymentMethod).toContainText("Transfer");
    await expect(
      correctionDialog.getByRole("textbox", { name: "Payment amount 1", exact: true }),
    ).toHaveValue(/4[\s,]?100/);
    await correctionDialog
      .getByRole("textbox", { name: "Correction reason", exact: true })
      .fill(paymentFixture.reason);
    await rapidClick(
      correctionDialog.getByRole("button", { name: "Apply payment correction", exact: true }),
    );
    await expect(primaryPage.getByText("Payment correction saved.", { exact: true })).toBeVisible();
    await expect(correctionDialog).toBeHidden();
    await expect.poll(() => primaryAudit.correctionMutationRequests.length).toBe(1);
    await expect
      .poll(() =>
        prisma.auditLog.count({
          where: {
            action: "POS_PAYMENT_CORRECTION",
            entity: "CustomerOrder",
            entityId: eligibleId,
          },
        }),
      )
      .toBe(1);

    await primaryPage.setViewportSize(mobileViewport);
    await primaryPage.reload({ waitUntil: "domcontentloaded" });
    const refreshedSale = paymentCorrectionSale(primaryPage, eligibleId);
    await expect(refreshedSale).toContainText(paymentFixture.eligibleReceipt.number);
    await expect(refreshedSale).toContainText("Transfer");
    await input.testInfo.attach("cashier-payment-correction-mobile", {
      body: await primaryPage.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  } finally {
    await primaryContext.close();
  }

  const reloginContext = await createCashierBrowserContext(input.browser, input.baseOrigin);
  await authenticateCashierContext(reloginContext, input.baseOrigin);
  const reloginPage = await reloginContext.newPage();
  const reloginAudit = await installCashierPaymentBrowserAudit(reloginPage, input.baseOrigin);
  try {
    await reloginPage.setViewportSize(mobileViewport);
    await gotoDirect(
      reloginPage,
      `/pos/history?registerId=${encodeURIComponent(paymentFixture.eligibleRegister.id)}`,
    );
    const reloggedSale = paymentCorrectionSale(reloginPage, eligibleId);
    await expect(reloggedSale).toContainText(paymentFixture.eligibleReceipt.number);
    await expect(reloggedSale).toContainText("Transfer");
    await reloggedSale.getByRole("button", { name: "Correct payment", exact: true }).click();
    const historyDialog = reloginPage.getByRole("dialog", { name: "Correct payment" });
    await expect(historyDialog).toContainText(
      /Cash\s+KGS\s*4,100\.00\s+→\s+Transfer\s+KGS\s*4,100\.00/,
    );
    await expect(historyDialog).toContainText(paymentFixture.reason);
    await historyDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(historyDialog).toBeHidden();

    await reloginPage.setViewportSize(desktopViewport);
    await gotoDirect(
      reloginPage,
      `/pos/history?registerId=${encodeURIComponent(paymentFixture.ineligibleRegister.id)}`,
    );
    const ineligibleSale = paymentCorrectionSale(reloginPage, paymentFixture.ineligibleReceipt.id);
    await expect(ineligibleSale).toContainText(paymentFixture.ineligibleReceipt.number);
    await expect(ineligibleSale).toContainText("66,390.00");
    await expect(
      ineligibleSale.getByRole("button", { name: "Correct payment", exact: true }),
    ).toBeDisabled();
    await expect(ineligibleSale).toContainText(
      "The original shift is closed, so its recorded payment cannot be changed.",
    );
    await input.testInfo.attach("cashier-payment-correction-ineligible", {
      body: await reloginPage.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  } finally {
    await reloginContext.close();
  }

  const [
    saleAfter,
    shiftAfter,
    snapshotAfter,
    costAfter,
    stockMovementsAfter,
    cashMovementsAfter,
    audit,
  ] = await Promise.all([
    prisma.customerOrder.findUniqueOrThrow({
      where: { id: eligibleId },
      include: { lines: true, payments: true },
    }),
    prisma.registerShift.findUniqueOrThrow({
      where: { id: paymentFixture.eligibleShiftId },
    }),
    prisma.inventorySnapshot.findUniqueOrThrow({
      where: {
        storeId_productId_variantKey: {
          storeId: fixture.storeId,
          productId: fixture.product.id,
          variantKey: fixture.variantKey,
        },
      },
    }),
    prisma.productCost.findUniqueOrThrow({
      where: {
        organizationId_productId_variantKey: {
          organizationId: fixture.organizationId,
          productId: fixture.product.id,
          variantKey: fixture.variantKey,
        },
      },
    }),
    prisma.stockMovement.findMany({
      where: { storeId: fixture.storeId, productId: fixture.product.id },
      orderBy: { id: "asc" },
    }),
    prisma.cashDrawerMovement.findMany({
      where: { shiftId: paymentFixture.eligibleShiftId },
      orderBy: { id: "asc" },
    }),
    prisma.auditLog.findFirstOrThrow({
      where: {
        action: "POS_PAYMENT_CORRECTION",
        entity: "CustomerOrder",
        entityId: eligibleId,
      },
    }),
  ]);

  expect(saleAfter.createdAt.toISOString()).toBe(paymentFixture.eligibleReceipt.createdAt);
  expect(saleAfter.completedAt?.toISOString()).toBe(paymentFixture.eligibleReceipt.completedAt);
  expect(saleAfter.totalKgs.toString()).toBe(saleBefore.totalKgs.toString());
  expect(saleAfter.lines).toEqual(saleBefore.lines);
  expect(saleAfter.payments).toHaveLength(1);
  expect(saleAfter.payments[0]).toMatchObject({
    method: PosPaymentMethod.TRANSFER,
    shiftId: paymentFixture.eligibleShiftId,
    isRefund: false,
    createdById: cashier.id,
  });
  expect(Number(saleAfter.payments[0]!.amountKgs)).toBe(paymentFixture.eligibleReceipt.totalKgs);
  expect(Number(shiftAfter.expectedCashKgs)).toBe(0);
  expect(snapshotAfter).toEqual(snapshotBefore);
  expect(costAfter).toEqual(costBefore);
  expect(stockMovementsAfter).toEqual(stockMovementsBefore);
  expect(cashMovementsAfter).toEqual(cashMovementsBefore);
  expect(audit.actorId).toBe(cashier.id);
  expect(audit.before).toMatchObject({
    effectivePayments: [{ method: PosPaymentMethod.CASH, amountKgs: 4_100 }],
    completedAt: paymentFixture.eligibleReceipt.completedAt,
  });
  expect(audit.after).toMatchObject({
    effectivePayments: [{ method: PosPaymentMethod.TRANSFER, amountKgs: 4_100 }],
    cashDeltaKgs: -4_100,
    reason: paymentFixture.reason,
    correctedById: cashier.id,
  });
  expect(primaryAudit.consoleErrors).toEqual([]);
  expect(primaryAudit.pageErrors).toEqual([]);
  expect(primaryAudit.externalRequests).toEqual([]);
  expect(reloginAudit.consoleErrors).toEqual([]);
  expect(reloginAudit.pageErrors).toEqual([]);
  expect(reloginAudit.externalRequests).toEqual([]);
  expect(reloginAudit.correctionMutationRequests).toEqual([]);

  const evidence = {
    actorRole: "CASHIER",
    eligibleReceipt: paymentFixture.eligibleReceipt.number,
    ineligibleReceipt: paymentFixture.ineligibleReceipt.number,
    beforePayment: "CASH 4100",
    afterPayment: "TRANSFER 4100",
    historyCompletedAt,
    persistedCompletedAt: saleAfter.completedAt?.toISOString(),
    correctionMutationRequests: primaryAudit.correctionMutationRequests.length,
    auditEvents: 1,
    shiftExpectedCashKgs: Number(shiftAfter.expectedCashKgs),
    stockUnchanged: true,
    cogsUnchanged: true,
    refreshPassed: true,
    reloginPassed: true,
    inaccessibleReason: "SHIFT_CLOSED",
  };
  await input.testInfo.attach("cashier-payment-correction-evidence", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });
  console.info(`[POS-PAYMENT-CORRECTION-EVIDENCE] ${JSON.stringify(evidence)}`);
};

const openMobileSaleWithProduct = async (
  page: Page,
  audit: PosOperationsAudit,
  quantity: number,
) => {
  const mutationTotalsBefore = {
    createDraft: posOperationsMutationCount(audit, "pos.sales.createDraft"),
    addLine: posOperationsMutationCount(audit, "pos.sales.addLine"),
    updateLine: posOperationsMutationCount(audit, "pos.sales.updateLine"),
  };
  await page.setViewportSize(mobileViewport);
  await gotoDirect(page, `/pos/sell?registerId=${encodeURIComponent(fixture.register.id)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Sell" })).toBeVisible();
  await page.getByRole("button", { name: "Add products", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Catalog" })).toBeVisible();
  await page.getByRole("combobox", { name: "Search", exact: true }).fill(fixture.product.sku);
  const product = page.locator(
    `[data-testid="pos-product-button"][data-product-id="${fixture.product.id}"]`,
  );
  await expect(product).toContainText(fixture.product.name);
  await product.click();

  const lineDialog = page.getByRole("dialog", { name: fixture.product.name });
  await expect(lineDialog).toBeVisible();
  for (let current = 1; current < quantity; current += 1) {
    await lineDialog.getByRole("button", { name: "Increase quantity", exact: true }).click();
  }
  await expect(lineDialog.getByTestId("pos-line-qty")).toHaveText(String(quantity));
  await lineDialog.getByRole("button", { name: "↵", exact: true }).click();
  await expect(lineDialog).toBeHidden();
  await expect(
    page.getByTestId("pos-cart-line").filter({ hasText: fixture.product.name }),
  ).toBeVisible();
  await expectMutationTotal(audit, "pos.sales.createDraft", mutationTotalsBefore.createDraft + 1);
  await expectMutationTotal(audit, "pos.sales.addLine", mutationTotalsBefore.addLine + 1);
  await expectMutationTotal(audit, "pos.sales.updateLine", mutationTotalsBefore.updateLine + 1);
  await expect
    .poll(async () => {
      const persistedLine = await prisma.customerOrderLine.findFirst({
        where: {
          productId: fixture.product.id,
          customerOrder: {
            registerId: fixture.register.id,
            status: "DRAFT",
            isHeld: false,
          },
        },
        select: { qty: true },
      });
      return persistedLine?.qty ?? null;
    })
    .toBe(quantity);
};

test.describe.configure({ mode: "serial" });

test.afterEach(async ({ posOperationsAudit }, testInfo) => {
  await attachPosOperationsAuditOnFailure(testInfo, posOperationsAudit);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("BZR-REQ-0080/0081/0082 foreign-tenant register and shift remain undiscoverable", async ({
  page,
  posOperationsAudit,
}) => {
  await page.setViewportSize(desktopViewport);
  await gotoDirect(
    page,
    `/pos/shifts?registerId=${encodeURIComponent(fixture.foreignRegister.id)}`,
  );
  await expect(page.getByRole("heading", { level: 1, name: "Shifts" })).toBeVisible();
  await expect(page.getByText("Select register first", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(fixture.foreignRegister.name, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Record", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close shift", exact: true })).toHaveCount(0);
  expect(posOperationsAudit.allowedMutations).toEqual([]);

  const foreignShift = await prisma.registerShift.findUniqueOrThrow({
    where: { id: fixture.foreignShift.id },
  });
  expect(foreignShift).toMatchObject({
    organizationId: fixture.foreignOrganizationId,
    storeId: fixture.foreignStoreId,
    registerId: fixture.foreignRegister.id,
    status: "OPEN",
  });
  assertCleanPosOperationsAudit(posOperationsAudit);
});

test("BZR-REQ-0079/0080/0081/0082 POS operations and cashier payment corrections reconcile exactly once", async ({
  page,
  browser,
  baseURL,
  posOperationsAudit,
}, testInfo) => {
  test.setTimeout(240_000);
  await installOwnedIdempotencyKeys(page);
  await seedPaymentCorrectionBrowserFixtures();
  await runCashierPaymentCorrectionJourney({
    browser,
    baseOrigin: assertAuthenticatedE2EBaseUrl(baseURL),
    testInfo,
  });

  const [baselineShift, baselineSnapshot, baselineCost, baselineCustomer] = await Promise.all([
    prisma.registerShift.findUniqueOrThrow({ where: { id: fixture.shift.id } }),
    prisma.inventorySnapshot.findUniqueOrThrow({
      where: {
        storeId_productId_variantKey: {
          storeId: fixture.storeId,
          productId: fixture.product.id,
          variantKey: fixture.variantKey,
        },
      },
    }),
    prisma.productCost.findUniqueOrThrow({
      where: {
        organizationId_productId_variantKey: {
          organizationId: fixture.organizationId,
          productId: fixture.product.id,
          variantKey: fixture.variantKey,
        },
      },
    }),
    prisma.customer.findUniqueOrThrow({ where: { id: fixture.customer.id } }),
  ]);
  expect(baselineShift).toMatchObject({
    status: "OPEN",
    registerId: fixture.register.id,
  });
  expect(Number(baselineShift.openingCashKgs)).toBe(fixture.shift.openingCashKgs);
  expect(baselineSnapshot.onHand).toBe(fixture.product.baselineOnHand);
  expect(Number(baselineCost.avgCostKgs)).toBe(fixture.product.unitCostKgs);
  expect(baselineCost.costBasisQty).toBe(fixture.product.baselineOnHand);
  expect(Number(baselineCost.costBasisValueKgs)).toBe(
    fixture.product.baselineOnHand * fixture.product.unitCostKgs,
  );
  expect(baselineCustomer).toMatchObject({ orderCount: 0, lastOrderAt: null });
  await expect(
    prisma.customerOrder.count({ where: { registerId: fixture.register.id } }),
  ).resolves.toBe(0);

  await openMobileSaleWithProduct(page, posOperationsAudit, fixture.cashSaleQuantity);
  const customerRow = page
    .getByRole("button")
    .filter({ hasText: "Client" })
    .filter({ hasText: "Retail customer" });
  await customerRow.click();
  const customerDialog = page.getByRole("dialog", { name: "Select customer" });
  await customerDialog
    .getByPlaceholder("Search customer by name or phone")
    .fill(fixture.customer.name);
  const customerResult = customerDialog
    .getByRole("button")
    .filter({ hasText: fixture.customer.name });
  await expect(customerResult).toBeVisible();
  await customerResult.click();
  await expect(customerDialog).toBeHidden();
  await expectMutationTotal(posOperationsAudit, "pos.sales.updateCustomer", 1);

  await page.getByRole("button", { name: "Go to payment", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Payment summary", exact: true })).toBeVisible();
  await expect(page.getByTestId("pos-cart-total")).toContainText(
    fixture.cashSaleTotalKgs.toFixed(2),
  );
  await rapidClick(page.getByRole("button", { name: "Complete sale", exact: true }));
  await expect(page.getByRole("heading", { name: "Sale completed", exact: true })).toBeVisible();
  await expectMutationTotal(posOperationsAudit, "pos.sales.complete", 1);

  await expect
    .poll(() =>
      prisma.customerOrder.count({
        where: {
          registerId: fixture.register.id,
          status: "COMPLETED",
          isDebt: false,
          lines: { some: { productId: fixture.product.id } },
        },
      }),
    )
    .toBe(1);
  const cashSale = await prisma.customerOrder.findFirstOrThrow({
    where: {
      registerId: fixture.register.id,
      status: "COMPLETED",
      isDebt: false,
      lines: { some: { productId: fixture.product.id } },
    },
    include: { lines: true, payments: true },
  });
  expect(cashSale).toMatchObject({
    organizationId: fixture.organizationId,
    storeId: fixture.storeId,
    registerId: fixture.register.id,
    shiftId: fixture.shift.id,
    customerName: fixture.customer.name,
    status: "COMPLETED",
  });
  expect(Number(cashSale.totalKgs)).toBe(fixture.cashSaleTotalKgs);
  expect(cashSale.lines).toHaveLength(1);
  expect(cashSale.lines[0]).toMatchObject({
    productId: fixture.product.id,
    qty: fixture.cashSaleQuantity,
  });
  expect(Number(cashSale.lines[0]!.unitCostKgs)).toBe(fixture.product.unitCostKgs);
  expect(cashSale.payments).toHaveLength(1);
  expect(cashSale.payments[0]).toMatchObject({
    method: "CASH",
    shiftId: fixture.shift.id,
    isRefund: false,
  });
  expect(Number(cashSale.payments[0]!.amountKgs)).toBe(fixture.cashSaleTotalKgs);

  await page.setViewportSize(mobileViewport);
  await gotoDirect(page, `/pos/history?registerId=${encodeURIComponent(fixture.register.id)}`);
  await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
  const cashSaleCard = page.locator("article").filter({ hasText: cashSale.number });
  await expect(cashSaleCard).toBeVisible();
  await cashSaleCard.getByRole("button", { name: "Return", exact: true }).click();
  const returnDialog = page.getByRole("dialog", { name: "Return dialog" });
  await expect(returnDialog).toBeVisible();
  await expect(returnDialog).toContainText(fixture.product.name);
  await returnDialog.locator('input[inputmode="numeric"]').fill(String(fixture.returnQuantity));
  await expect(returnDialog).toContainText(fixture.returnTotalKgs.toFixed(2));
  await rapidClick(returnDialog.getByRole("button", { name: "Complete return", exact: true }));
  await expect(page.getByText("Return completed.", { exact: true })).toBeVisible();
  await expect(returnDialog).toBeHidden();
  await expectMutationTotal(posOperationsAudit, "pos.returns.createDraft", 1);
  await expectMutationTotal(posOperationsAudit, "pos.returns.addLine", 1);
  await expectMutationTotal(posOperationsAudit, "pos.returns.complete", 1);

  const completedReturn = await prisma.saleReturn.findFirstOrThrow({
    where: { originalSaleId: cashSale.id, status: "COMPLETED" },
    include: { lines: true, payments: true, refundRequests: true },
  });
  expect(completedReturn).toMatchObject({
    organizationId: fixture.organizationId,
    storeId: fixture.storeId,
    registerId: fixture.register.id,
    shiftId: fixture.shift.id,
    originalSaleId: cashSale.id,
    status: "COMPLETED",
  });
  expect(Number(completedReturn.totalKgs)).toBe(fixture.returnTotalKgs);
  expect(completedReturn.lines).toHaveLength(1);
  expect(completedReturn.lines[0]).toMatchObject({
    productId: fixture.product.id,
    qty: fixture.returnQuantity,
  });
  expect(Number(completedReturn.lines[0]!.unitCostKgs)).toBe(fixture.product.unitCostKgs);
  expect(completedReturn.payments).toHaveLength(1);
  expect(completedReturn.payments[0]).toMatchObject({ method: "CASH", isRefund: true });
  expect(Number(completedReturn.payments[0]!.amountKgs)).toBe(fixture.returnTotalKgs);
  expect(completedReturn.refundRequests).toHaveLength(0);

  await openMobileSaleWithProduct(page, posOperationsAudit, fixture.debtSaleQuantity);
  await page.getByRole("button", { name: "Go to payment", exact: true }).click();
  const debtToggle = page.locator("label").filter({ hasText: "Sell in debt" }).last();
  await debtToggle.getByRole("switch").click();
  await page.getByPlaceholder("Customer full name").fill(fixture.debtCustomerName);
  await rapidClick(page.getByRole("button", { name: "Complete debt sale", exact: true }));
  await expect(page.getByRole("heading", { name: "Sale completed", exact: true })).toBeVisible();
  await expectMutationTotal(posOperationsAudit, "pos.sales.complete", 2);

  await expect
    .poll(() =>
      prisma.customerOrder.count({
        where: {
          registerId: fixture.register.id,
          status: "COMPLETED",
          isDebt: true,
          debtSettledAt: null,
        },
      }),
    )
    .toBe(1);
  const debtSale = await prisma.customerOrder.findFirstOrThrow({
    where: {
      registerId: fixture.register.id,
      status: "COMPLETED",
      isDebt: true,
      debtSettledAt: null,
    },
    include: { lines: true, payments: true },
  });
  expect(debtSale).toMatchObject({
    debtCustomerName: fixture.debtCustomerName,
    customerName: fixture.debtCustomerName,
    shiftId: fixture.shift.id,
  });
  expect(Number(debtSale.totalKgs)).toBe(fixture.debtSaleTotalKgs);
  expect(debtSale.lines).toHaveLength(1);
  expect(debtSale.lines[0]?.qty).toBe(fixture.debtSaleQuantity);
  expect(debtSale.payments).toHaveLength(0);

  await page.setViewportSize(desktopViewport);
  await gotoDirect(page, `/pos/debts?registerId=${encodeURIComponent(fixture.register.id)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Debts" })).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search by full name or sale number" })
    .fill(fixture.debtCustomerName);
  const debtRow = page.getByRole("row").filter({ hasText: debtSale.number });
  await expect(debtRow).toContainText(fixture.debtCustomerName);
  await rapidClick(debtRow.getByRole("button", { name: "Returned debt", exact: true }));
  await expect(page.getByText("Debt returned.", { exact: true })).toBeVisible();
  await expectMutationTotal(posOperationsAudit, "pos.debts.settle", 1);
  await expect(debtRow).toBeHidden();

  const settledDebt = await prisma.customerOrder.findUniqueOrThrow({
    where: { id: debtSale.id },
    include: { payments: true },
  });
  expect(settledDebt.debtSettledAt).toBeInstanceOf(Date);
  expect(settledDebt.debtSettledById).toBe(fixture.adminUserId);
  expect(settledDebt.payments).toHaveLength(1);
  expect(settledDebt.payments[0]).toMatchObject({
    method: "CASH",
    shiftId: fixture.shift.id,
    providerRef: `debt:${debtSale.number}`,
    isRefund: false,
  });
  expect(Number(settledDebt.payments[0]!.amountKgs)).toBe(fixture.debtSaleTotalKgs);

  await gotoDirect(page, `/pos/shifts?registerId=${encodeURIComponent(fixture.register.id)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Shifts" })).toBeVisible();
  await expect(page.getByText("Shift sales", { exact: true })).toBeVisible();
  const cashType = page.getByRole("combobox", { name: "Cash movement type" });
  await expect(cashType).toContainText("Pay in");
  await page.getByPlaceholder("Amount").fill(String(fixture.cash.payInKgs));
  await page.getByPlaceholder("Reason").fill(fixture.cash.payInReason);
  await rapidClick(page.getByRole("button", { name: "Record", exact: true }));
  await expect(page.getByText("Cash movement completed.", { exact: true })).toBeVisible();
  await expectMutationTotal(posOperationsAudit, "pos.cash.record", 1);

  await cashType.click();
  await page.getByRole("option", { name: "Pay out", exact: true }).click();
  await page.getByPlaceholder("Amount").fill(String(fixture.cash.payOutKgs));
  await expect(page.getByRole("combobox", { name: "Cash-out reason" })).toContainText(
    "Cash collection",
  );
  await page.getByPlaceholder("Comment").fill(fixture.cash.payOutComment);
  await rapidClick(page.getByRole("button", { name: "Record", exact: true }));
  await expectMutationTotal(posOperationsAudit, "pos.cash.record", 2);
  await expect
    .poll(() => prisma.cashDrawerMovement.count({ where: { shiftId: fixture.shift.id } }))
    .toBe(2);
  const calculatedCashTiles = page
    .locator(".bazaar-admin-info-tile")
    .filter({ hasText: "Calculated cash" });
  await expect(calculatedCashTiles).toHaveCount(2);
  for (const tile of await calculatedCashTiles.all()) {
    await expect(tile).toContainText(fixture.expectedCashKgs.toFixed(2));
  }

  await page.getByPlaceholder("Amount").fill(String(fixture.expectedCashKgs + 1));
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(
    page.getByText("Cash out exceeds available drawer cash.", { exact: true }),
  ).toBeVisible();
  expect(posOperationsMutationCount(posOperationsAudit, "pos.cash.record")).toBe(2);
  await expect(
    prisma.cashDrawerMovement.count({ where: { shiftId: fixture.shift.id } }),
  ).resolves.toBe(2);

  const closeShift = page.getByRole("button", { name: "Close shift", exact: true });
  await page.getByPlaceholder("Counted cash").fill(String(fixture.countedCashKgs));
  await page.getByRole("checkbox", { name: "Confirm close", exact: true }).check();
  await expect(closeShift).toBeDisabled();
  expect(posOperationsMutationCount(posOperationsAudit, "pos.shifts.close")).toBe(0);
  await page.getByPlaceholder("Enter closing note").fill(fixture.closingNote);
  await rapidClick(closeShift);
  await expect(page.getByText("Closed completed.", { exact: true })).toBeVisible();
  await expectMutationTotal(posOperationsAudit, "pos.shifts.close", 1);

  const [
    finalShift,
    finalOrders,
    finalReturns,
    finalPayments,
    finalCashMovements,
    finalStockMovements,
    finalSnapshot,
    finalCost,
    finalCustomer,
    ownedIdempotencyKeys,
    fiscalReceiptCount,
    refundRequestCount,
    emailLogCount,
    automationDeliveryCount,
  ] = await Promise.all([
    prisma.registerShift.findUniqueOrThrow({ where: { id: fixture.shift.id } }),
    prisma.customerOrder.findMany({
      where: { registerId: fixture.register.id },
      include: { lines: true, payments: true, fiscalReceipts: true },
      orderBy: { completedAt: "asc" },
    }),
    prisma.saleReturn.findMany({
      where: { registerId: fixture.register.id },
      include: { lines: true, payments: true },
    }),
    prisma.salePayment.findMany({ where: { shiftId: fixture.shift.id } }),
    prisma.cashDrawerMovement.findMany({
      where: { shiftId: fixture.shift.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.stockMovement.findMany({
      where: { productId: fixture.product.id, storeId: fixture.storeId },
    }),
    prisma.inventorySnapshot.findUniqueOrThrow({
      where: {
        storeId_productId_variantKey: {
          storeId: fixture.storeId,
          productId: fixture.product.id,
          variantKey: fixture.variantKey,
        },
      },
    }),
    prisma.productCost.findUniqueOrThrow({
      where: {
        organizationId_productId_variantKey: {
          organizationId: fixture.organizationId,
          productId: fixture.product.id,
          variantKey: fixture.variantKey,
        },
      },
    }),
    prisma.customer.findUniqueOrThrow({ where: { id: fixture.customer.id } }),
    prisma.idempotencyKey.findMany({
      where: {
        userId: fixture.adminUserId,
        key: { startsWith: fixture.idempotencyKeyPrefix },
      },
    }),
    prisma.fiscalReceipt.count({
      where: { customerOrderId: { in: [cashSale.id, debtSale.id] } },
    }),
    prisma.refundRequest.count({ where: { originalSaleId: cashSale.id } }),
    prisma.customerOrderEmailLog.count({
      where: { customerOrderId: { in: [cashSale.id, debtSale.id] } },
    }),
    prisma.emailAutomationDelivery.count({
      where: { customerOrderId: { in: [cashSale.id, debtSale.id] } },
    }),
  ]);

  expect(finalShift).toMatchObject({
    status: "CLOSED",
    registerId: fixture.register.id,
    storeId: fixture.storeId,
    closedById: fixture.adminUserId,
    notes: fixture.closingNote,
  });
  expect(finalShift.closedAt).toBeInstanceOf(Date);
  expect(Number(finalShift.expectedCashKgs)).toBe(fixture.expectedCashKgs);
  expect(Number(finalShift.closingCashCountedKgs)).toBe(fixture.countedCashKgs);
  expect(Number(finalShift.closingCashCountedKgs) - Number(finalShift.expectedCashKgs)).toBe(-5);

  expect(finalOrders).toHaveLength(2);
  expect(finalOrders.every((order) => order.status === "COMPLETED")).toBe(true);
  expect(finalOrders.every((order) => order.lines.length === 1)).toBe(true);
  expect(finalOrders.every((order) => order.fiscalReceipts.length === 0)).toBe(true);
  expect(finalReturns).toHaveLength(1);
  expect(finalReturns[0]?.status).toBe("COMPLETED");
  expect(finalPayments).toHaveLength(3);
  expect(
    finalPayments
      .map((payment) => ({
        amountKgs: Number(payment.amountKgs),
        isRefund: payment.isRefund,
        customerOrderId: payment.customerOrderId,
        saleReturnId: payment.saleReturnId,
        method: payment.method,
      }))
      .sort(
        (left, right) =>
          left.amountKgs - right.amountKgs || Number(right.isRefund) - Number(left.isRefund),
      ),
  ).toEqual(
    [
      {
        amountKgs: fixture.returnTotalKgs,
        isRefund: true,
        customerOrderId: cashSale.id,
        saleReturnId: completedReturn.id,
        method: "CASH",
      },
      {
        amountKgs: fixture.debtSaleTotalKgs,
        isRefund: false,
        customerOrderId: debtSale.id,
        saleReturnId: null,
        method: "CASH",
      },
      {
        amountKgs: fixture.cashSaleTotalKgs,
        isRefund: false,
        customerOrderId: cashSale.id,
        saleReturnId: null,
        method: "CASH",
      },
    ].sort(
      (left, right) =>
        left.amountKgs - right.amountKgs || Number(right.isRefund) - Number(left.isRefund),
    ),
  );

  expect(finalCashMovements).toHaveLength(2);
  expect(
    finalCashMovements
      .map((movement) => ({
        type: movement.type,
        amountKgs: Number(movement.amountKgs),
        createdById: movement.createdById,
      }))
      .sort((left, right) => left.type.localeCompare(right.type)),
  ).toEqual(
    [
      { type: "PAY_IN", amountKgs: fixture.cash.payInKgs, createdById: fixture.adminUserId },
      { type: "PAY_OUT", amountKgs: fixture.cash.payOutKgs, createdById: fixture.adminUserId },
    ].sort((left, right) => left.type.localeCompare(right.type)),
  );

  expect(finalStockMovements).toHaveLength(3);
  const movementsByReference = new Map(
    finalStockMovements.map((movement) => [movement.referenceId, movement]),
  );
  expect(movementsByReference.get(cashSale.id)).toMatchObject({
    type: "SALE",
    qtyDelta: -fixture.cashSaleQuantity,
  });
  expect(Number(movementsByReference.get(cashSale.id)!.inventoryValueDeltaKgs)).toBe(
    -fixture.cashSaleQuantity * fixture.product.unitCostKgs,
  );
  expect(movementsByReference.get(completedReturn.id)).toMatchObject({
    type: "RETURN",
    qtyDelta: fixture.returnQuantity,
  });
  expect(Number(movementsByReference.get(completedReturn.id)!.inventoryValueDeltaKgs)).toBe(
    fixture.returnQuantity * fixture.product.unitCostKgs,
  );
  expect(movementsByReference.get(debtSale.id)).toMatchObject({
    type: "SALE",
    qtyDelta: -fixture.debtSaleQuantity,
  });
  expect(Number(movementsByReference.get(debtSale.id)!.inventoryValueDeltaKgs)).toBe(
    -fixture.debtSaleQuantity * fixture.product.unitCostKgs,
  );
  expect(finalSnapshot.onHand).toBe(fixture.expectedFinalOnHand);
  expect(finalCost.costBasisQty).toBe(fixture.expectedFinalOnHand);
  expect(Number(finalCost.costBasisValueKgs)).toBe(
    fixture.expectedFinalOnHand * fixture.product.unitCostKgs,
  );
  expect(Number(finalCost.avgCostKgs)).toBe(fixture.product.unitCostKgs);
  expect(finalCustomer.orderCount).toBe(1);
  expect(finalCustomer.lastOrderAt).toBeInstanceOf(Date);

  const lifecycleAudits = await prisma.auditLog.findMany({
    where: {
      organizationId: fixture.organizationId,
      actorId: fixture.adminUserId,
      action: {
        in: [
          "POS_SALE_COMPLETE",
          "POS_RETURN_CREATE",
          "POS_RETURN_LINE_ADD",
          "POS_RETURN_COMPLETE",
          "POS_DEBT_SETTLE",
          "POS_CASH_DRAWER_MOVEMENT",
          "POS_SHIFT_CLOSE",
        ],
      },
      entityId: {
        in: [
          cashSale.id,
          debtSale.id,
          completedReturn.id,
          fixture.shift.id,
          ...finalCashMovements.map((movement) => movement.id),
        ],
      },
    },
  });
  const auditCounts = lifecycleAudits.reduce<Record<string, number>>((counts, audit) => {
    counts[audit.action] = (counts[audit.action] ?? 0) + 1;
    return counts;
  }, {});
  expect(auditCounts).toEqual({
    POS_SALE_COMPLETE: 2,
    POS_RETURN_CREATE: 1,
    POS_RETURN_LINE_ADD: 1,
    POS_RETURN_COMPLETE: 1,
    POS_DEBT_SETTLE: 1,
    POS_CASH_DRAWER_MOVEMENT: 2,
    POS_SHIFT_CLOSE: 1,
  });
  expect(ownedIdempotencyKeys).toHaveLength(7);
  expect(
    ownedIdempotencyKeys.every((item) => item.key.startsWith(fixture.idempotencyKeyPrefix)),
  ).toBe(true);
  expect(
    ownedIdempotencyKeys.reduce<Record<string, number>>((counts, item) => {
      counts[item.route] = (counts[item.route] ?? 0) + 1;
      return counts;
    }, {}),
  ).toEqual({
    "pos.sales.complete": 2,
    "pos.returns.complete": 1,
    "pos.debts.settle": 1,
    "pos.cash.record": 2,
    "pos.shifts.close": 1,
  });
  expect(fiscalReceiptCount).toBe(0);
  expect(refundRequestCount).toBe(0);
  expect(emailLogCount).toBe(0);
  expect(automationDeliveryCount).toBe(0);
  expect(posOperationsAudit.allowedMutations).toHaveLength(16);
  assertCleanPosOperationsAudit(posOperationsAudit);
});
