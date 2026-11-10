import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StockReceivingCommerce } from "@/lib/stockReceivingCommerce";
import { prisma } from "@/server/db/prisma";
import { runJob } from "@/server/jobs";
import * as audit from "@/server/services/audit";
import { postStockReceiving } from "@/server/services/inventory";
import {
  postReviewedStockReceiving,
  previewStockReceiving,
  reconcileStockReceivingAttempt,
} from "@/server/services/stockReceivingCommerce";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const withoutSalePrices = (receiving: StockReceivingCommerce): StockReceivingCommerce => ({
  ...receiving,
  lines: receiving.lines.map(({ salePriceKgs: _price, ...line }) => line),
});

(shouldRunDbTests ? describe : describe.skip)(
  "reviewed stock receiving and selected-store pricing",
  () => {
    beforeEach(resetDatabase);
    afterEach(() => vi.restoreAllMocks());

    async function fixture() {
      const f = await seedBase({ plan: "ENTERPRISE" });
      await prisma.organization.update({
        where: { id: f.org.id },
        data: { retailWholesaleEnabled: true },
      });
      await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 150 } });
      await prisma.storeProduct.updateMany({
        where: { productId: f.product.id },
        data: { isDirect: true, isHistorical: false },
      });
      const [variant, unselectedVariant] = await Promise.all(
        ["Selected variant", "Other variant"].map((name) =>
          prisma.productVariant.create({ data: { productId: f.product.id, name, attributes: {} } }),
        ),
      );
      const otherStore = await prisma.store.create({
        data: { organizationId: f.org.id, name: "Other store", code: "OTHER" },
      });
      await prisma.storeProduct.create({
        data: {
          organizationId: f.org.id,
          storeId: otherStore.id,
          productId: f.product.id,
          isDirect: true,
        },
      });
      async function setPrice(
        storeId: string,
        variantId: string | null,
        retail: number,
        wholesale: number,
      ) {
        const where = {
          organizationId: f.org.id,
          storeId,
          productId: f.product.id,
          variantId,
          variantKey: variantId ?? "BASE",
        };
        await prisma.storePrice.create({
          data: { ...where, priceKgs: retail, discountType: "PERCENTAGE", discountPercentage: 5 },
        });
        await prisma.storePriceTypes.create({
          data: { ...where, retailPriceKgs: retail, wholesalePriceKgs: wholesale },
        });
      }
      await setPrice(f.store.id, null, 120, 90);
      await setPrice(f.store.id, variant.id, 80, 60);
      await setPrice(f.store.id, unselectedVariant.id, 70, 55);
      await setPrice(otherStore.id, null, 222, 180);
      await setPrice(otherStore.id, variant.id, 333, 250);

      const principal = { organizationId: f.org.id, actorId: f.adminUser.id };
      // Use real valued movements rather than inventing an inventory/cost snapshot.
      await postStockReceiving({
        ...principal,
        storeId: f.store.id,
        requestId: "receiving-commerce-baseline",
        idempotencyKey: randomUUID(),
        lines: [
          { productId: f.product.id, quantity: 10, unitCost: 40 },
          { productId: f.product.id, variantId: variant.id, quantity: 4, unitCost: 30 },
          { productId: f.product.id, variantId: unselectedVariant.id, quantity: 2, unitCost: 20 },
        ],
      });
      const receiving: StockReceivingCommerce = {
        storeId: f.store.id,
        supplierName: "Reviewed supplier",
        referenceNumber: "RCV-COMMERCE",
        note: "Keep this employee comment",
        lines: [
          { productId: f.product.id, quantity: 5, unitCost: 60, salePriceKgs: 135 },
          {
            productId: f.product.id,
            variantId: variant.id,
            quantity: 2,
            unitCost: 45,
            salePriceKgs: 95,
          },
        ],
      };
      const review = (change = receiving, actor = principal) =>
        previewStockReceiving({ ...actor, receiving: change });
      const request = async (change = receiving, actor = principal) => ({
        ...actor,
        requestId: "receiving-commerce-test",
        receiving: change,
        token: (await review(change, actor)).token,
        idempotencyKey: randomUUID(),
      });
      const prices = (storeId = f.store.id, variantKey = "BASE") =>
        prisma.storePriceTypes.findFirstOrThrow({
          where: { storeId, productId: f.product.id, variantKey },
        });
      const state = async () => ({
        products: await prisma.product.findMany({ orderBy: { id: "asc" } }),
        variants: await prisma.productVariant.findMany({ orderBy: { id: "asc" } }),
        assignments: await prisma.storeProduct.findMany({ orderBy: { id: "asc" } }),
        stocks: await prisma.inventorySnapshot.findMany({ orderBy: { id: "asc" } }),
        movements: await prisma.stockMovement.findMany({ orderBy: { id: "asc" } }),
        costs: await prisma.productCost.findMany({ orderBy: { id: "asc" } }),
        standard: await prisma.storePrice.findMany({ orderBy: { id: "asc" } }),
        types: await prisma.storePriceTypes.findMany({ orderBy: { id: "asc" } }),
        bindings: await prisma.priceBookStoreItem.findMany({ orderBy: { id: "asc" } }),
        audit: await prisma.auditLog.findMany({ orderBy: { id: "asc" } }),
        receipts: await prisma.idempotencyKey.findMany({ orderBy: { id: "asc" } }),
      });
      const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
      const connectSharedPrices = async () => {
        const book = await caller.priceBooks.create({ name: `Common ${randomUUID()}` });
        for (const change of [
          {
            kind: "PRICES" as const,
            entries: [{ productId: f.product.id, retailPriceKgs: 120, wholesalePriceKgs: 90 }],
          },
          { kind: "CONNECT" as const, storeIds: [f.store.id, otherStore.id], preserveLocal: false },
        ]) {
          const preview = await caller.priceBooks.preview({ bookId: book.id, change });
          await caller.priceBooks.publish({
            bookId: book.id,
            change,
            token: preview.token,
            idempotencyKey: randomUUID(),
          });
        }
        return book;
      };
      return {
        ...f,
        variant,
        unselectedVariant,
        otherStore,
        principal,
        receiving,
        review,
        request,
        prices,
        state,
        connectSharedPrices,
        caller,
      };
    }

    it("previews current/projected unit costs and prices without committing any records", async () => {
      const f = await fixture(),
        before = await f.state();
      const preview = await f.review();
      expect(preview).toMatchObject({
        currencyCode: "KGS",
        currencyRateKgsPerUnit: 1,
        pricingAllowed: true,
        retailWholesaleEnabled: true,
      });
      expect(preview.lines).toHaveLength(2);
      expect(preview.lines.find((line) => !line.variantId)).toMatchObject({
        productId: f.product.id,
        unitId: f.baseUnit.id,
        unitLabel: f.baseUnit.code,
        currentSalePriceKgs: 120,
        changesSalePrice: true,
        valuation: {
          current: { quantity: 10, unitCostKgs: 40, status: "KNOWN" },
          projected: { quantity: 15, unitCostKgs: 46.67, status: "KNOWN" },
        },
      });
      expect(preview.lines.find((line) => line.variantId === f.variant.id)).toMatchObject({
        currentSalePriceKgs: 80,
        valuation: {
          current: { quantity: 4, unitCostKgs: 30, status: "KNOWN" },
          projected: { quantity: 6, unitCostKgs: 35, status: "KNOWN" },
        },
      });
      expect(await f.state()).toEqual(before);
    });

    it("changes only selected-store base/variant retail at posting and preserves wholesale, discounts and identities", async () => {
      const f = await fixture(),
        before = await f.state(),
        request = await f.request();
      expect(await f.state()).toEqual(before);
      const receipt = await postReviewedStockReceiving(request);
      expect(receipt).toMatchObject({
        storeId: f.store.id,
        lineCount: 2,
        totalQuantity: 7,
        totalCostKgs: 390,
      });
      expect(await f.prices()).toMatchObject({
        retailPriceKgs: expect.anything(),
        wholesalePriceKgs: expect.anything(),
      });
      expect(Number((await f.prices()).retailPriceKgs)).toBe(135);
      expect(Number((await f.prices()).wholesalePriceKgs)).toBe(90);
      expect(Number((await f.prices(f.store.id, f.variant.id)).retailPriceKgs)).toBe(95);
      expect(Number((await f.prices(f.store.id, f.variant.id)).wholesalePriceKgs)).toBe(60);
      const after = await f.state();
      expect(after.products).toEqual(before.products);
      expect(after.variants).toEqual(before.variants);
      const beforeAssignment = before.assignments.find((row) => row.storeId === f.store.id)!;
      const afterAssignment = after.assignments.find((row) => row.storeId === f.store.id)!;
      // The existing receive writer refreshes updatedAt through an assignment upsert.
      // Every identity, access flag and assigning user must still be unchanged.
      expect({ ...afterAssignment, updatedAt: beforeAssignment.updatedAt }).toEqual(
        beforeAssignment,
      );
      expect(afterAssignment.updatedAt.getTime()).toBeGreaterThanOrEqual(
        beforeAssignment.updatedAt.getTime(),
      );
      expect(after.assignments.filter((row) => row.storeId !== f.store.id)).toEqual(
        before.assignments.filter((row) => row.storeId !== f.store.id),
      );
      expect(
        after.types.filter(
          (row) => row.storeId === f.otherStore.id || row.variantId === f.unselectedVariant.id,
        ),
      ).toEqual(
        before.types.filter(
          (row) => row.storeId === f.otherStore.id || row.variantId === f.unselectedVariant.id,
        ),
      );
      expect(
        after.stocks.find((row) => row.storeId === f.store.id && row.variantKey === "BASE")?.onHand,
      ).toBe(15);
      expect(
        after.stocks.find((row) => row.storeId === f.store.id && row.variantId === f.variant.id)
          ?.onHand,
      ).toBe(6);
      expect(after.stocks.find((row) => row.variantId === f.unselectedVariant.id)).toEqual(
        before.stocks.find((row) => row.variantId === f.unselectedVariant.id),
      );
      expect(after.movements).toHaveLength(before.movements.length + 2);
      expect(after.audit.find((row) => row.action === "RECEIVING_COMMERCE_POST")).toMatchObject({
        entityId: receipt.receivingId,
      });
      const priceAudit = after.audit.filter((row) => row.action === "RECEIVING_SALE_PRICE_UPDATE");
      expect(priceAudit).toHaveLength(2);
      for (const row of priceAudit) {
        expect(row.after).toMatchObject({ storeId: f.store.id, receivingId: receipt.receivingId });
      }
      for (const row of after.standard) {
        const original = before.standard.find((candidate) => candidate.id === row.id)!;
        expect(row.discountType).toBe(original.discountType);
        expect(row.discountPercentage).toEqual(original.discountPercentage);
        expect(row.discountStartsAt).toEqual(original.discountStartsAt);
        expect(row.discountEndsAt).toEqual(original.discountEndsAt);
      }
    });

    it("keeps every price when omitted and accepts an explicit zero selling price", async () => {
      const f = await fixture(),
        before = await f.state();
      await postReviewedStockReceiving(await f.request(withoutSalePrices(f.receiving)));
      expect((await f.state()).types).toEqual(before.types);
      expect((await f.state()).standard).toEqual(before.standard);
      const zero: StockReceivingCommerce = {
        ...f.receiving,
        lines: [{ ...f.receiving.lines[0], salePriceKgs: 0 }],
      };
      await postReviewedStockReceiving(await f.request(zero));
      expect(Number((await f.prices()).retailPriceKgs)).toBe(0);
      expect(Number((await f.prices()).wholesalePriceKgs)).toBe(90);
    });

    it("detaches shared retail only for the selected store and keeps other stores and wholesale connected", async () => {
      const f = await fixture();
      const book = await f.connectSharedPrices();
      const entry = await prisma.priceBookEntry.findMany({
        where: { bookId: book.id },
        orderBy: { id: "asc" },
      });
      const other = await f.prices(f.otherStore.id);
      const receiving = { ...f.receiving, lines: [f.receiving.lines[0]] };
      expect((await f.review(receiving)).lines[0]).toMatchObject({
        sharedRetail: true,
        changesSalePrice: true,
      });
      await postReviewedStockReceiving(await f.request(receiving));
      expect(
        await prisma.priceBookStoreItem.findFirstOrThrow({
          where: { storeId: f.store.id, productId: f.product.id, variantKey: "BASE" },
        }),
      ).toMatchObject({ retailShared: false, wholesaleShared: true });
      expect(
        await prisma.priceBookStoreItem.findFirstOrThrow({
          where: { storeId: f.otherStore.id, productId: f.product.id, variantKey: "BASE" },
        }),
      ).toMatchObject({ retailShared: true, wholesaleShared: true });
      expect(await f.prices(f.otherStore.id)).toEqual(other);
      expect(Number((await f.prices()).wholesalePriceKgs)).toBe(90);
      expect(
        await prisma.priceBookEntry.findMany({
          where: { bookId: book.id },
          orderBy: { id: "asc" },
        }),
      ).toEqual(entry);
    });

    it("does not detach inheritance or materialize a no-op price override", async () => {
      const f = await fixture();
      await f.connectSharedPrices();
      const before = await f.state();
      const receiving = { ...f.receiving, lines: [{ ...f.receiving.lines[0], salePriceKgs: 120 }] };
      expect((await f.review(receiving)).lines[0]).toMatchObject({
        sharedRetail: true,
        changesSalePrice: false,
      });
      await postReviewedStockReceiving(await f.request(receiving));
      const after = await f.state();
      expect(after.bindings).toEqual(before.bindings);
      expect(after.standard).toEqual(before.standard);
      expect(after.types).toEqual(before.types);
    });

    it("does not claim that a variant's product fallback comes from a shared base price", async () => {
      const f = await fixture();
      await f.connectSharedPrices();
      await prisma.storePrice.deleteMany({
        where: { storeId: f.store.id, variantKey: f.variant.id },
      });
      await prisma.storePriceTypes.deleteMany({
        where: { storeId: f.store.id, variantKey: f.variant.id },
      });
      const baseBinding = await prisma.priceBookStoreItem.findFirstOrThrow({
        where: { storeId: f.store.id, productId: f.product.id, variantKey: "BASE" },
      });
      const receiving = {
        ...f.receiving,
        lines: [
          {
            productId: f.product.id,
            variantId: f.variant.id,
            quantity: 2,
            unitCost: 45,
            salePriceKgs: 160,
          },
        ],
      };
      expect((await f.review(receiving)).lines[0]).toMatchObject({
        currentSalePriceKgs: 150,
        sharedRetail: false,
        changesSalePrice: true,
      });
      await postReviewedStockReceiving(await f.request(receiving));
      expect(Number((await f.prices(f.store.id, f.variant.id)).retailPriceKgs)).toBe(160);
      expect(
        await prisma.priceBookStoreItem.findFirstOrThrow({ where: { id: baseBinding.id } }),
      ).toEqual(baseBinding);
      expect(Number((await f.prices()).retailPriceKgs)).toBe(120);
      expect(
        Number(
          (await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } })).basePriceKgs,
        ),
      ).toBe(150);
    });

    it("keeps an explicit zero variant retail separate from shared base pricing on a no-op", async () => {
      const f = await fixture();
      await f.connectSharedPrices();
      await prisma.storePrice.deleteMany({
        where: { storeId: f.store.id, variantKey: f.variant.id },
      });
      await prisma.storePriceTypes.updateMany({
        where: { storeId: f.store.id, variantKey: f.variant.id },
        data: { retailPriceKgs: 0 },
      });
      const before = await f.state();
      const receiving = {
        ...f.receiving,
        lines: [
          {
            productId: f.product.id,
            variantId: f.variant.id,
            quantity: 2,
            unitCost: 45,
            salePriceKgs: 0,
          },
        ],
      };
      expect((await f.review(receiving)).lines[0]).toMatchObject({
        currentSalePriceKgs: 0,
        sharedRetail: false,
        changesSalePrice: false,
      });
      await postReviewedStockReceiving(await f.request(receiving));
      const after = await f.state();
      expect(after.standard).toEqual(before.standard);
      expect(after.types).toEqual(before.types);
      expect(after.bindings).toEqual(before.bindings);
      expect(Number((await f.prices()).retailPriceKgs)).toBe(120);
      expect(
        after.audit.filter((row) => row.action === "RECEIVING_SALE_PRICE_UPDATE"),
      ).toHaveLength(0);
    });

    it("retains fallback prices without creating store records on a same-value request", async () => {
      const f = await fixture();
      await prisma.storePrice.deleteMany({ where: { storeId: f.store.id, variantKey: "BASE" } });
      await prisma.storePriceTypes.deleteMany({
        where: { storeId: f.store.id, variantKey: "BASE" },
      });
      const receiving = { ...f.receiving, lines: [{ ...f.receiving.lines[0], salePriceKgs: 150 }] };
      expect((await f.review(receiving)).lines[0]).toMatchObject({
        currentSalePriceKgs: 150,
        changesSalePrice: false,
      });
      await postReviewedStockReceiving(await f.request(receiving));
      expect(
        await prisma.storePrice.count({ where: { storeId: f.store.id, variantKey: "BASE" } }),
      ).toBe(0);
      expect(
        await prisma.storePriceTypes.count({ where: { storeId: f.store.id, variantKey: "BASE" } }),
      ).toBe(0);
    });

    it("rolls back stock, costs, prices, audits and the idempotency claim if auditing fails", async () => {
      const f = await fixture(),
        request = await f.request(),
        before = await f.state();
      const original = audit.writeAuditLog;
      vi.spyOn(audit, "writeAuditLog").mockImplementation(async (tx, params) => {
        await original(tx, params);
        // Fail after both receiving lines and all price changes have been written.
        if (params.action === "RECEIVING_COMMERCE_POST") throw new Error("audit unavailable");
      });
      await expect(postReviewedStockReceiving(request)).rejects.toThrow("audit unavailable");
      vi.restoreAllMocks();
      expect(await f.state()).toEqual(before);
      await expect(postReviewedStockReceiving(request)).resolves.toMatchObject({
        totalQuantity: 7,
      });
    });

    it("replays a lost successful response once and rejects a different payload on the same key", async () => {
      const f = await fixture(),
        request = await f.request();
      const receipt = await postReviewedStockReceiving(request),
        after = await f.state();
      expect(await postReviewedStockReceiving(request)).toEqual(receipt);
      expect(await reconcileStockReceivingAttempt(request)).toEqual({
        status: "POSTED",
        result: receipt,
      });
      expect(await f.state()).toEqual(after);
      const changedReceiving = {
        ...request.receiving,
        lines: [{ ...request.receiving.lines[0], quantity: 6 }],
      };
      const changedReview = await f.review(changedReceiving);
      await expect(
        postReviewedStockReceiving({
          ...request,
          receiving: changedReceiving,
          token: changedReview.token,
        }),
      ).rejects.toMatchObject({ message: "idempotencyKeyPayloadMismatch", code: "CONFLICT" });
      expect(await f.state()).toEqual(after);
    });

    it("serializes two deliveries of the same request into exactly one receiving", async () => {
      const f = await fixture(),
        request = await f.request(),
        before = await f.state();
      const [first, second] = await Promise.all([
        postReviewedStockReceiving(request),
        postReviewedStockReceiving(request),
      ]);
      expect(first).toEqual(second);
      const after = await f.state();
      expect(after.movements).toHaveLength(before.movements.length + 2);
      expect(after.stocks.find((row) => row.variantKey === "BASE")?.onHand).toBe(15);
    });

    it("retains old posted/canceled receiving decisions through cleanup and recovers without a second stock write", async () => {
      const f = await fixture();
      const postedRequest = await f.request();
      const posted = await postReviewedStockReceiving(postedRequest);
      const canceledRequest = await f.request();
      expect(await reconcileStockReceivingAttempt(canceledRequest)).toEqual({
        status: "CANCELED",
        result: null,
      });
      const durableWhere = {
        route: "inventory.stockReceivingReviewed",
        userId: f.adminUser.id,
        key: { in: [postedRequest.idempotencyKey, canceledRequest.idempotencyKey] },
      };
      const olderThanCleanup = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      await prisma.idempotencyKey.updateMany({
        where: durableWhere,
        data: { createdAt: olderThanCleanup },
      });
      const durableBefore = await prisma.idempotencyKey.findMany({
        where: durableWhere,
        orderBy: { key: "asc" },
      });
      expect(durableBefore).toHaveLength(2);
      expect(durableBefore.map((row) => row.response)).toEqual(
        expect.arrayContaining([
          { status: "POSTED", result: posted },
          { status: "CANCELED", result: null },
        ]),
      );
      const oldOtherRoute = await prisma.idempotencyKey.create({
        data: {
          userId: f.adminUser.id,
          key: randomUUID(),
          route: "inventory.stockReceivingReviewed.other",
          createdAt: olderThanCleanup,
          response: { old: true },
        },
      });
      const recentOtherRoute = await prisma.idempotencyKey.create({
        data: {
          userId: f.adminUser.id,
          key: randomUUID(),
          route: "inventory.stockReceiving",
          response: { recent: true },
        },
      });
      // Both original 15-minute review tokens have expired by the time the browser recovers.
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60 * 1000);
      expect(await runJob("cleanup-idempotency-keys")).toMatchObject({
        status: "ok",
        details: { deleted: 1 },
      });
      expect(
        await prisma.idempotencyKey.findUnique({ where: { id: oldOtherRoute.id } }),
      ).toBeNull();
      expect(
        await prisma.idempotencyKey.findUnique({ where: { id: recentOtherRoute.id } }),
      ).toEqual(recentOtherRoute);
      expect(
        await prisma.idempotencyKey.findMany({ where: durableWhere, orderBy: { key: "asc" } }),
      ).toEqual(durableBefore);
      const afterCleanup = await f.state();
      expect(await reconcileStockReceivingAttempt(postedRequest)).toEqual({
        status: "POSTED",
        result: posted,
      });
      expect(await postReviewedStockReceiving(postedRequest)).toEqual(posted);
      expect(await reconcileStockReceivingAttempt(canceledRequest)).toEqual({
        status: "CANCELED",
        result: null,
      });
      await expect(postReviewedStockReceiving(canceledRequest)).rejects.toMatchObject({
        message: "receivingAttemptCanceled",
        code: "CONFLICT",
      });
      expect(await f.state()).toEqual(afterCleanup);
    });

    it("terminally cancels an unknown attempt so a late original cannot post", async () => {
      const f = await fixture(),
        request = await f.request(),
        before = await f.state();
      expect(await reconcileStockReceivingAttempt(request)).toEqual({
        status: "CANCELED",
        result: null,
      });
      const afterCancel = await f.state();
      await expect(postReviewedStockReceiving(request)).rejects.toMatchObject({
        message: "receivingAttemptCanceled",
        code: "CONFLICT",
      });
      expect(await f.state()).toEqual(afterCancel);
      expect(afterCancel.stocks).toEqual(before.stocks);
      expect(afterCancel.movements).toEqual(before.movements);
      expect(afterCancel.costs).toEqual(before.costs);
      expect(afterCancel.standard).toEqual(before.standard);
      expect(afterCancel.types).toEqual(before.types);
      expect(afterCancel.audit).toHaveLength(before.audit.length + 1);
      expect(
        afterCancel.audit.find((row) => row.entityId === request.idempotencyKey),
      ).toMatchObject({
        action: "RECEIVING_ATTEMPT_CANCELED",
      });
    });

    it("makes reconciliation and a late post race to one terminal outcome", async () => {
      const f = await fixture(),
        request = await f.request(),
        before = await f.state();
      const [posting, recovery] = await Promise.allSettled([
        postReviewedStockReceiving(request),
        reconcileStockReceivingAttempt(request),
      ]);
      expect(recovery.status).toBe("fulfilled");
      if (recovery.status !== "fulfilled") throw recovery.reason;
      const after = await f.state();
      if (recovery.value.status === "CANCELED") {
        expect(posting.status).toBe("rejected");
        expect(after.movements).toEqual(before.movements);
        expect(after.stocks).toEqual(before.stocks);
        expect(after.types).toEqual(before.types);
      } else {
        expect(posting.status).toBe("fulfilled");
        if (posting.status === "fulfilled") expect(recovery.value.result).toEqual(posting.value);
        expect(after.movements).toHaveLength(before.movements.length + 2);
      }
    });

    it.each(["price", "currency", "rate", "unit", "stock"] as const)(
      "rejects stale %s state without partial changes",
      async (kind) => {
        const f = await fixture();
        if (kind === "rate")
          await prisma.store.update({
            where: { id: f.store.id },
            data: { currencyCode: "USD", currencyRateKgsPerUnit: 87 },
          });
        const request = await f.request();
        if (kind === "price")
          await prisma.storePriceTypes.updateMany({
            where: { storeId: f.store.id, variantKey: "BASE" },
            data: { retailPriceKgs: 121 },
          });
        if (kind === "currency")
          await prisma.store.update({
            where: { id: f.store.id },
            data: { currencyCode: "USD", currencyRateKgsPerUnit: 87 },
          });
        if (kind === "rate")
          await prisma.store.update({
            where: { id: f.store.id },
            data: { currencyRateKgsPerUnit: 88 },
          });
        if (kind === "unit") {
          const unit = await prisma.unit.create({
            data: { organizationId: f.org.id, code: "new", labelRu: "new", labelKg: "new" },
          });
          await prisma.product.update({
            where: { id: f.product.id },
            data: { baseUnitId: unit.id, unit: unit.code },
          });
        }
        if (kind === "stock")
          await prisma.inventorySnapshot.updateMany({
            where: { storeId: f.store.id, variantKey: "BASE" },
            data: { onHand: { increment: 1 }, version: { increment: 1 } },
          });
        const afterConcurrentChange = await f.state();
        await expect(postReviewedStockReceiving(request)).rejects.toMatchObject({
          message: "receivingReviewStale",
          code: "CONFLICT",
        });
        expect(await f.state()).toEqual(afterConcurrentChange);
      },
    );

    it("rejects signed payload tampering without posting or changing prices", async () => {
      const f = await fixture(),
        request = await f.request(),
        before = await f.state();
      await expect(
        postReviewedStockReceiving({
          ...request,
          receiving: {
            ...request.receiving,
            lines: [{ ...request.receiving.lines[0], salePriceKgs: 1 }],
          },
        }),
      ).rejects.toMatchObject({ message: "receivingReviewStale", code: "CONFLICT" });
      await expect(
        postReviewedStockReceiving({ ...request, token: `${request.token.slice(0, -1)}x` }),
      ).rejects.toMatchObject({ message: "receivingReviewStale", code: "CONFLICT" });
      expect(await f.state()).toEqual(before);
    });

    it("uses canonical KGS amounts for USD stores and preserves the currency snapshot", async () => {
      const f = await fixture();
      await prisma.store.update({
        where: { id: f.store.id },
        data: { currencyCode: "USD", currencyRateKgsPerUnit: 87 },
      });
      const receiving = {
        ...f.receiving,
        lines: [{ ...f.receiving.lines[0], quantity: 1, unitCost: 435, salePriceKgs: 870 }],
      };
      expect(await f.review(receiving)).toMatchObject({
        currencyCode: "USD",
        currencyRateKgsPerUnit: 87,
      });
      const receipt = await postReviewedStockReceiving(await f.request(receiving));
      expect(receipt.totalCostKgs).toBe(435);
      expect(Number((await f.prices()).retailPriceKgs)).toBe(870);
    });

    it("updates the ordinary retail price and its existing alias when wholesale mode is disabled", async () => {
      const f = await fixture();
      await prisma.organization.update({
        where: { id: f.org.id },
        data: { retailWholesaleEnabled: false },
      });
      const before = await f.state();
      expect(await f.review()).toMatchObject({ retailWholesaleEnabled: false });
      await postReviewedStockReceiving(await f.request());
      const after = await f.state();
      for (const [variantKey, expectedRetail, expectedWholesale] of [
        ["BASE", 135, 90],
        [f.variant.id, 95, 60],
      ] as const) {
        const standard = after.standard.find(
          (row) => row.storeId === f.store.id && row.variantKey === variantKey,
        )!;
        expect(Number(standard.priceKgs)).toBe(expectedRetail);
        expect(Number(standard.discountPercentage)).toBe(5);
        const alias = await f.prices(f.store.id, variantKey);
        expect(Number(alias.retailPriceKgs)).toBe(expectedRetail);
        expect(Number(alias.wholesalePriceKgs)).toBe(expectedWholesale);
      }
      expect(after.standard.filter((row) => row.storeId === f.otherStore.id)).toEqual(
        before.standard.filter((row) => row.storeId === f.otherStore.id),
      );
      expect(after.types.filter((row) => row.storeId === f.otherStore.id)).toEqual(
        before.types.filter((row) => row.storeId === f.otherStore.id),
      );
    });

    it("enforces role, store access and organization from fresh persisted records", async () => {
      const f = await fixture(),
        before = await f.state(),
        adminRequest = await f.request();
      for (const user of [f.staffUser, f.cashierUser]) {
        await expect(
          f.review(f.receiving, { ...f.principal, actorId: user.id }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      const manager = { ...f.principal, actorId: f.managerUser.id };
      const request = await f.request(f.receiving, manager);
      await prisma.userStoreAccess.deleteMany({ where: { userId: f.managerUser.id } });
      await expect(postReviewedStockReceiving(request)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await prisma.user.update({
        where: { id: f.adminUser.id },
        data: { role: "STAFF", isOrgOwner: false },
      });
      await expect(postReviewedStockReceiving(adminRequest)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(await f.state()).toEqual(before);
    });

    it("rejects other-organization actors, stores and product identities", async () => {
      const f = await fixture();
      const org = await prisma.organization.create({
        data: { name: "Other organization", plan: "ENTERPRISE" },
      });
      const store = await prisma.store.create({
        data: { organizationId: org.id, name: "Foreign", code: "FOREIGN" },
      });
      const actor = await prisma.user.create({
        data: {
          organizationId: org.id,
          email: `${randomUUID()}@test.local`,
          name: "Foreign admin",
          role: "ADMIN",
          isOrgOwner: true,
          passwordHash: "hash",
        },
      });
      const unit = await prisma.unit.create({
        data: { organizationId: org.id, code: "each", labelRu: "each", labelKg: "each" },
      });
      const product = await prisma.product.create({
        data: {
          organizationId: org.id,
          sku: "FOREIGN",
          name: "Foreign product",
          unit: unit.code,
          baseUnitId: unit.id,
        },
      });
      const before = await f.state();
      await expect(
        f.review(f.receiving, { ...f.principal, actorId: actor.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(f.review({ ...f.receiving, storeId: store.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        f.review({ ...f.receiving, lines: [{ productId: product.id, quantity: 1, unitCost: 1 }] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await f.state()).toEqual(before);
    });

    it("keeps normal receiving available on Starter while enforcing its store-pricing gate", async () => {
      const f = await fixture();
      await prisma.organization.update({ where: { id: f.org.id }, data: { plan: "STARTER" } });
      const receiving = withoutSalePrices(f.receiving);
      expect(await f.review(receiving)).toMatchObject({ pricingAllowed: false });
      await postReviewedStockReceiving(await f.request(receiving));
      const before = await f.state();
      await expect(f.review()).rejects.toMatchObject({
        message: "featureLockedStorePrices",
        code: "FORBIDDEN",
      });
      expect(await f.state()).toEqual(before);
    });

    it("freshly checks a plan downgrade between review and posting", async () => {
      const f = await fixture(),
        request = await f.request();
      await prisma.organization.update({ where: { id: f.org.id }, data: { plan: "STARTER" } });
      const before = await f.state();
      await expect(postReviewedStockReceiving(request)).rejects.toMatchObject({
        message: "featureLockedStorePrices",
        code: "FORBIDDEN",
      });
      expect(await f.state()).toEqual(before);
    });

    it("recovers a committed result after trial expiry without allowing a new receipt", async () => {
      const f = await fixture(),
        request = await f.request();
      const receipt = await f.caller.inventory.postReviewedStockReceiving(request);
      await prisma.organization.update({
        where: { id: f.org.id },
        data: {
          subscriptionStatus: "ACTIVE",
          subscriptionBillingMode: "SELF_SERVE",
          trialEndsAt: new Date(Date.now() - 60_000),
          currentPeriodEndsAt: new Date(Date.now() - 60_000),
        },
      });
      const before = await f.state();
      expect(await f.caller.inventory.reconcileStockReceivingAttempt(request)).toEqual({
        status: "POSTED",
        result: receipt,
      });
      await expect(
        f.caller.inventory.postReviewedStockReceiving({ ...request, idempotencyKey: randomUUID() }),
      ).rejects.toMatchObject({ message: "trialExpired" });
      expect(await f.state()).toEqual(before);
    });

    it("cannot recover a receipt after the employee loses access to its store", async () => {
      const f = await fixture(),
        manager = { ...f.principal, actorId: f.managerUser.id },
        request = await f.request(f.receiving, manager);
      await postReviewedStockReceiving(request);
      await prisma.userStoreAccess.deleteMany({ where: { userId: f.managerUser.id } });
      const before = await f.state();
      await expect(reconcileStockReceivingAttempt(request)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(await f.state()).toEqual(before);
    });

    it("permits recovery of an expired signed review but forbids a new posting with it", async () => {
      const f = await fixture(),
        committed = await f.request(),
        uncommitted = await f.request();
      const receipt = await postReviewedStockReceiving(committed);
      const expiresAt = (await f.review()).expiresAt;
      vi.spyOn(Date, "now").mockReturnValue(new Date(expiresAt).getTime() + 60_000);
      expect(await reconcileStockReceivingAttempt(committed)).toEqual({
        status: "POSTED",
        result: receipt,
      });
      await expect(postReviewedStockReceiving(uncommitted)).rejects.toMatchObject({
        message: "receivingReviewStale",
        code: "CONFLICT",
      });
      expect(await reconcileStockReceivingAttempt(uncommitted)).toEqual({
        status: "CANCELED",
        result: null,
      });
    });
  },
);
