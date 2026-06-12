import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("pos entry navigation", () => {
  it("does not auto-redirect away from the POS hub when a shift is already open", async () => {
    const source = await readSource("src/app/(app)/pos/page.tsx");

    expect(source).toContain("router.push(`/pos/sell?registerId=${shift.registerId}`)");
    expect(source).not.toContain("router.replace(`/pos/sell?registerId=${selectedRegister.id}`)");
    expect(source).not.toContain("router.replace(`/pos/sell?registerId=");
    expect(source).toContain('t("entry.readyToSell")');
  });

  it("shows a scoped close-shift path from the open-shift POS hub", async () => {
    const source = await readSource("src/app/(app)/pos/page.tsx");

    expect(source).toContain("const activeRegisterId =");
    expect(source).toContain("href={`/pos/shifts?registerId=${activeRegisterId}`}");
    expect(source).toContain('t("shifts.closeShift")');
    expect(source).toContain("{!openShift ? (");
  });

  it("requires a closing note in the shift UI when counted cash does not match expected cash", async () => {
    const source = await readSource("src/app/(app)/pos/shifts/page.tsx");

    expect(source).toContain("const closeNoteRequired =");
    expect(source).toContain("Math.abs(cashDifference) > 0.009");
    expect(source).toContain('t("shifts.differenceNoteRequired")');
    expect(source).toContain("!closeNoteValid");
  });

  it("keeps the cashier POS screen on theme tokens for dark mode support", async () => {
    const source = await readSource("src/app/(app)/pos/sell/page.tsx");

    expect(source).toContain("bg-card");
    expect(source).toContain("bg-muted/40");
    expect(source).toContain("text-success-foreground");
    expect(source).toContain("dark:hover:bg-accent/40");
    expect(source).not.toContain("bg-white");
    expect(source).not.toContain("bg-slate-50");
    expect(source).not.toContain("border-slate-200");
    expect(source).not.toContain("bg-[#fffdf4]");
    expect(source).not.toContain("bg-emerald-");
    expect(source).not.toContain("text-emerald-");
  });

  it("does not block adding out-of-stock or missing-price products to a POS sale", async () => {
    const source = await readSource("src/app/(app)/pos/sell/page.tsx");

    expect(source).toContain("const priceMissing = priceKgs === null;");
    expect(source).toContain(
      "void trackCartSyncPromise(handleAddLine(product.id, product, { refocusSearch: true }));",
    );
    expect(source).toContain("priceMissing ? priceMissingLabel : formatSaleMoney(priceKgs)");
    expect(source).toContain('priceMissingLabel={t("sell.priceMissing")}');
    expect(source).not.toContain("const productBlocked = priceMissing;");
    expect(source).not.toContain("aria-disabled={productBlocked}");
    expect(source).not.toContain('t("sell.priceMissingCannotSell")');
    expect(source).not.toContain("stockBlocked");
    expect(source).not.toContain('t("sell.insufficientStock")');
  });

  it("lets cashiers edit POS sale line unit prices inline", async () => {
    const pageSource = await readSource("src/app/(app)/pos/sell/page.tsx");
    const routerSource = await readSource("src/server/trpc/routers/pos.ts");
    const serviceSource = await readSource("src/server/services/pos.ts");

    expect(pageSource).toContain("handleUpdateLinePrice");
    expect(pageSource).toContain("formatSaleMoneyDraft(line.unitPriceKgs)");
    expect(pageSource).toContain("patchOptimisticLine(lineId, { unitPriceKgs });");
    expect(pageSource).toContain("scheduleLineSync(lineId, { unitPriceKgs });");
    expect(routerSource).toContain("unitPriceKgs: z.number().min(0).optional()");
    expect(serviceSource).toContain("unitPriceKgs: nextUnitPriceKgs");
    expect(serviceSource).toContain("lineTotalKgs: roundMoney(nextUnitPriceKgs * nextQty)");
  });

  it("keeps POS cart interactions local-first without remounting rows or refetching sale lines", async () => {
    const pageSource = await readSource("src/app/(app)/pos/sell/page.tsx");

    expect(pageSource).toContain("serverLineId?: string;");
    expect(pageSource).toContain("serverLineId: updatedLine.id");
    expect(pageSource).toContain("const resolveRemoteLineId = useCallback");
    expect(pageSource).toContain("{ enabled: Boolean(saleId && !hasLocalCartLines)");
    expect(pageSource).toContain("const PosProductButton = memo(function PosProductButton");
    expect(pageSource).toContain("const handleProductClick = useCallback");
    expect(pageSource).toContain("removedOptimisticLineIdsRef.current.add(lineId);");
    expect(pageSource).toContain("pendingAddProductIdsRef.current.has(productId)");
    expect(pageSource).toContain("scheduleLineSync(localLineId, { qty: nextQty });");
    expect(pageSource).toContain("await flushPendingLineSyncs();");
    expect(pageSource).not.toContain("id: updatedLine.id");
    expect(pageSource).not.toContain("endCartSync(targetSaleId)");
    expect(pageSource).not.toContain("setPendingCartMutationCount");
    expect(pageSource).not.toContain("[focusLineSearchInput, hasOpenShift, saleId]");
  });

  it("clears POS cart runtime sync state between receipt sessions", async () => {
    const pageSource = await readSource("src/app/(app)/pos/sell/page.tsx");
    const cleanupBlock = pageSource.slice(
      pageSource.indexOf("const clearCartRuntimeSyncState"),
      pageSource.indexOf("const createDraftMutation"),
    );
    const completeBlock = pageSource.slice(
      pageSource.indexOf("const completeMutation"),
      pageSource.indexOf("const sale = saleQuery.data"),
    );
    const cancelBlock = pageSource.slice(
      pageSource.indexOf("const cancelDraftMutation"),
      pageSource.indexOf("const updateCustomerMutation"),
    );
    const handleAddLineBlock = pageSource.slice(
      pageSource.indexOf("const handleAddLine"),
      pageSource.indexOf("useEffect(() => {\n    if (!hasOpenShift)"),
    );

    expect(pageSource).toContain("const cartSessionVersionRef = useRef(0);");
    expect(cleanupBlock).toContain("cartSessionVersionRef.current += 1;");
    expect(cleanupBlock).toContain("Object.values(lineSyncTimersRef.current)");
    expect(cleanupBlock).toContain("lineSyncDraftsRef.current = {};");
    expect(cleanupBlock).toContain("lineSyncInFlightRef.current.clear();");
    expect(cleanupBlock).toContain("lineSyncPendingRef.current.clear();");
    expect(cleanupBlock).toContain("pendingAddProductIdsRef.current.clear();");
    expect(cleanupBlock).toContain("pendingCartSyncPromisesRef.current.clear();");
    expect(cleanupBlock).toContain("pendingCartMutationCountRef.current = 0;");
    expect(cleanupBlock).toContain("draftCreationRef.current = null;");
    expect(cleanupBlock).toContain("optimisticLineServerIdsRef.current = {};");
    expect(cleanupBlock).toContain("removedOptimisticLineIdsRef.current.clear();");
    expect(completeBlock).toContain("clearCartRuntimeSyncState();");
    expect(completeBlock).toContain("void Promise.all([");
    expect(cancelBlock).toContain("clearCartRuntimeSyncState();");
    expect(cancelBlock).toContain("void Promise.all([");
    expect(handleAddLineBlock).toContain("const cartSessionVersion = cartSessionVersionRef.current;");
    expect(handleAddLineBlock).toContain(
      "if (cartSessionVersionRef.current !== cartSessionVersion)",
    );
    expect(pageSource).not.toContain("onSuccess: (sale) =>");
  });

  it("keeps the new POS view for desktop and uses the dedicated mobile quick-sale flow only for phones", async () => {
    const pageSource = await readSource("src/app/(app)/pos/sell/page.tsx");

    expect(pageSource).toContain('window.matchMedia("(max-width: 767px)")');
    expect(pageSource).toContain("const DesktopPosSaleView = () => (");
    expect(pageSource).toContain("const MobilePosView = () => {");
    expect(pageSource).toContain("return isPhoneScreen ? MobilePosView() : DesktopPosSaleView();");
    expect(pageSource).toContain("const MobileCustomerSheet = () => {");
    expect(pageSource).toContain("{MobileCustomerSheet()}");
    expect(pageSource).not.toContain("<MobileCustomerSheet />");
    expect(pageSource).toContain('t("sell.openCart")');
    expect(pageSource).toContain('t("sell.customerSelectorTitle")');
    expect(pageSource).toContain('t("sell.paymentsTitle")');
  });

  it("keeps POS customer management inside the sale screen with email-or-phone contact", async () => {
    const pageSource = await readSource("src/app/(app)/pos/sell/page.tsx");
    const customerServiceSource = await readSource("src/server/services/customers.ts");
    const posRouterSource = await readSource("src/server/trpc/routers/pos.ts");

    expect(pageSource).toContain("type CustomerCreatePanelProps = {");
    expect(pageSource).toContain("const CustomerCreatePanel = ({");
    expect(pageSource).toContain('emailPlaceholder={t("sell.customerEmailPlaceholder")}');
    expect(pageSource).toContain('phonePlaceholder={t("sell.customerPhonePlaceholder")}');
    expect(pageSource).toContain('addressPlaceholder={t("sell.customerAddressPlaceholder")}');
    expect(pageSource).toContain('const phoneDigits = phone.replace(/\\D/g, "");');
    expect(pageSource).toContain("if (!email && !phoneDigits) {");
    expect(pageSource).toContain("email: email || null");
    expect(pageSource).toContain("const openCustomerEdit = () => {");
    expect(pageSource).toContain("const handleUpdateSelectedCustomer = async () => {");
    expect(pageSource).toContain('title={t("sell.editCustomer")}');
    expect(pageSource).toContain("setReceiptJournalOpen(true)");
    expect(pageSource).toContain('title={t("sell.receiptJournal")}');
    expect(pageSource).toContain("const handleStartJournalReturn = async () => {");
    expect(posRouterSource).toContain("update: cashierProcedure");
    expect(posRouterSource).toContain("cashiers: router({");
    expect(customerServiceSource).toContain("const rawPhone = normalizeOptionalText(input.phone)");
    expect(customerServiceSource).toContain("ensureCustomerContact({ email, phone });");
    expect(customerServiceSource).toContain('throw new AppError("customerPhoneDigitsRequired"');
  });

  it("keeps mobile quick-sale on theme tokens with images, customer selection, editable price, discount, and receipt actions", async () => {
    const pageSource = await readSource("src/app/(app)/pos/sell/page.tsx");

    expect(pageSource).toContain(
      '<header className="sticky top-0 z-30 border-b border-border bg-background/95 px-3 py-3 shadow-sm backdrop-blur md:hidden">',
    );
    expect(pageSource).toContain(
      "const primaryImage = product.images?.[0]?.url ?? product.photoUrl;",
    );
    expect(pageSource).toContain('variant="mobile"');
    expect(pageSource).toContain("currentCustomerLabel");
    expect(pageSource).toContain("handleSelectCustomer({");
    expect(pageSource).toContain("lineInputDrafts[line.id]?.price");
    expect(pageSource).not.toContain("key={`${line.id}:mobile-price:${line.unitPriceKgs}`}");
    expect(pageSource).toContain("handleUpdateLinePrice(");
    expect(pageSource).toContain('t("sell.saleDiscount")');
    expect(pageSource).toContain("handleComplete");
    expect(pageSource).toContain('handleReceiptPdf("print", "precheck")');
  });

  it("keeps POS product search stable while adding products optimistically", async () => {
    const pageSource = await readSource("src/app/(app)/pos/sell/page.tsx");
    const addLineMutationBlock = pageSource.slice(
      pageSource.indexOf("const addLineMutation"),
      pageSource.indexOf("const updateLineMutation"),
    );
    const handleAddLineBlock = pageSource.slice(
      pageSource.indexOf("const handleAddLine"),
      pageSource.indexOf("useEffect(() => {\n    if (!hasOpenShift)"),
    );

    expect(addLineMutationBlock).not.toContain("setLineSearch");
    expect(handleAddLineBlock).not.toContain('setLineSearch("")');
    expect(pageSource).toContain(
      "void trackCartSyncPromise(handleAddLine(product.id, product, { refocusSearch: true }));",
    );
    expect(pageSource).toContain("{ enabled: Boolean(saleId && !hasLocalCartLines)");
  });

  it("renders cashier products as readable rows with in-cart quantity controls", async () => {
    const pageSource = await readSource("src/app/(app)/pos/sell/page.tsx");

    expect(pageSource).toContain("line-clamp-3 break-words");
    expect(pageSource).toContain("cartQtyByProductId");
    expect(pageSource).toContain("onProductDecrement");
    expect(pageSource).toContain('addProductLabel={t("sell.addProduct")}');
    expect(pageSource).toContain('<div className="space-y-2">');
    expect(pageSource).not.toContain(
      "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4 2xl:grid-cols-5",
    );
  });

  it("validates POS payments after local cart sync and intentionally allows zero-total sales", async () => {
    const pageSource = await readSource("src/app/(app)/pos/sell/page.tsx");
    const routerSource = await readSource("src/server/trpc/routers/pos.ts");
    const serviceSource = await readSource("src/server/services/pos.ts");

    expect(pageSource).toContain("await waitForCartSync();");
    expect(pageSource).toContain("const currentLines = getCurrentCartLines();");
    expect(pageSource).toContain("const currentCartTotalKgs =");
    expect(pageSource).toContain("buildPosPaymentSubmitPayload({");
    expect(pageSource).toContain("cartTotalKgs: currentCartTotalKgs");
    expect(pageSource).toContain('paymentPayload.status === "paymentRequired"');
    expect(pageSource).toContain('paymentPayload.status === "paymentMismatch"');
    expect(pageSource).toContain("payments: paymentPayload.payments");
    expect(pageSource).toContain("paymentsRef.current");
    expect(pageSource).toContain("readOnly={payments.length === 1}");
    expect(pageSource).toContain("await flushAllPendingCartSync();");
    expect(pageSource).toContain("clearActiveDraftCache();");
    expect(pageSource).toContain("releaseUnresolvableLineSync");
    expect(pageSource).toContain("optimisticLineServerIdsRef");
    expect(routerSource).not.toContain("payments.length < 1");
    expect(serviceSource).toContain("normalizePayments(input.payments, { requirePayment: false })");
    expect(serviceSource).toContain("orderTotalMinorUnits > 0 && !normalizedPayments.length");
    expect(serviceSource).toContain("paymentTotalMinorUnits !== orderTotalMinorUnits");
  });
});
