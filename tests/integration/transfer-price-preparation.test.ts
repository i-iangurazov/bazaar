import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import * as audit from "@/server/services/audit";
import { transferStock } from "@/server/services/inventory";
import type { TransferAssortmentPreparation } from "@/lib/transferAssortmentPreparation";
import { transferAssortmentLines } from "@/lib/transferAssortmentPreparation";

(shouldRunDbTests ? describe : describe.skip)(
  "atomic transfer assortment and missing prices",
  () => {
    beforeEach(resetDatabase);
    async function fixture() {
      const f = await seedBase({ plan: "ENTERPRISE" });
      await prisma.organization.update({
        where: { id: f.org.id },
        data: { retailWholesaleEnabled: true },
      });
      await prisma.storeProduct.updateMany({
        where: { productId: f.product.id },
        data: { isDirect: true, isHistorical: false },
      });
      await prisma.productCost.create({
        data: { organizationId: f.org.id, productId: f.product.id, avgCostKgs: 60 },
      });
      await prisma.productBarcode.create({
        data: { organizationId: f.org.id, productId: f.product.id, value: "1234567890123" },
      });
      await prisma.inventorySnapshot.create({
        data: { storeId: f.store.id, productId: f.product.id, onHand: 10 },
      });
      await prisma.storePrice.create({
        data: {
          organizationId: f.org.id,
          storeId: f.store.id,
          productId: f.product.id,
          priceKgs: 120,
        },
      });
      await prisma.storePriceTypes.create({
        data: {
          organizationId: f.org.id,
          storeId: f.store.id,
          productId: f.product.id,
          retailPriceKgs: 120,
          wholesalePriceKgs: 90,
        },
      });
      const destination = await prisma.store.create({
        data: {
          organizationId: f.org.id,
          name: "Recipient",
          code: "DST",
          currencyCode: "USD",
          currencyRateKgsPerUnit: 87,
        },
      });
      const caller = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
      const config = (await caller.stores.catalogSettings({ storeId: destination.id })).settings!;
      config.connections.push({
        key: `store:${f.store.id}`,
        enabled: false,
        scope: "ALL",
        productIds: [],
      });
      const p = await caller.stores.previewCatalogSettings(config);
      await caller.stores.saveCatalogSettings({
        change: config,
        token: p.token,
        idempotencyKey: randomUUID(),
      });
      const change: TransferAssortmentPreparation = {
        fromStoreId: f.store.id,
        toStoreId: destination.id,
        selections: [{ productId: f.product.id, sourceKey: `store:${f.store.id}` }],
        lines: [{ productId: f.product.id }],
        prices: "MISSING",
      };
      const review = (c = change) => caller.inventory.previewTransferAssortment(c);
      const request = async (c = change) => ({
        change: c,
        token: (await review(c)).token,
        idempotencyKey: randomUUID(),
      });
      const prices = () =>
        prisma.storePriceTypes.findFirst({
          where: { storeId: destination.id, variantKey: "BASE" },
        });
      const stable = () =>
        Promise.all([
          prisma.product.findMany({ orderBy: { id: "asc" } }),
          prisma.productBarcode.findMany(),
          prisma.productCost.findMany(),
          prisma.inventorySnapshot.findMany({ orderBy: { id: "asc" } }),
          prisma.stockMovement.findMany(),
        ]);
      return { ...f, destination, caller, change, review, request, prices, stable };
    }
    it("connects from actual posted-document rows without reposting stock and keeps strict validation", async () => {
      const f = await fixture();
      const transfer = await transferStock({
        organizationId: f.org.id,
        actorId: f.adminUser.id,
        requestId: "posted-row-regression",
        fromStoreId: f.store.id,
        toStoreId: f.destination.id,
        lines: [{ productId: f.product.id, qty: 3 }],
        destinationAssortment: "INVENTORY_ONLY",
        idempotencyKey: randomUUID(),
      });
      const document = await f.caller.inventory.productMovementDocument({
        documentKey: `TRANSFER:TRANSFER:${transfer.transferId}`,
      });
      expect(document!.lines[0]).toHaveProperty("qtyDelta");
      const before = await f.stable();
      await expect(f.review({ ...f.change, lines: document!.lines })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      const change = { ...f.change, lines: transferAssortmentLines(document!.lines) };
      const preview = await f.review(change);
      expect(preview).toMatchObject({ added: 1, priceChanges: 1 });
      const request = { change, token: preview.token, idempotencyKey: randomUUID() };
      await f.caller.inventory.applyTransferAssortment(request);
      await f.caller.inventory.applyTransferAssortment(request);
      expect(await f.stable()).toEqual(before);
      expect(Number((await f.prices())!.retailPriceKgs)).toBe(120);
      expect(Number((await f.prices())!.wholesalePriceKgs)).toBe(90);
      expect(
        (await f.caller.products.list({ storeId: f.destination.id })).items.map((p) => p.id),
      ).toEqual([f.product.id]);
    });
    it.each([40, 500])(
      "connects %i selected products without opening unselected source products or altering stock",
      async (count) => {
        const f = await fixture();
        const ids = [f.product.id, ...Array.from({ length: count - 1 }, () => randomUUID())];
        const unselected = randomUUID();
        await prisma.product.createMany({
          data: [...ids.slice(1), unselected].map((id, i) => ({
            id,
            organizationId: f.org.id,
            name: `Bulk transfer ${i}`,
            sku: `BULK-${i}`,
            unit: f.baseUnit.code,
            baseUnitId: f.baseUnit.id,
          })),
        });
        await prisma.storeProduct.createMany({
          data: [...ids.slice(1), unselected].map((productId) => ({
            organizationId: f.org.id,
            storeId: f.store.id,
            productId,
            isDirect: true,
          })),
        });
        const before = await f.stable();
        const change = {
          ...f.change,
          selections: ids.map((productId) => ({ productId, sourceKey: `store:${f.store.id}` })),
          lines: transferAssortmentLines(ids.map((productId) => ({ productId }))),
        };
        const preview = await f.review(change);
        expect(preview.added).toBe(count);
        const request = { change, token: preview.token, idempotencyKey: randomUUID() };
        const applied = await f.caller.inventory.applyTransferAssortment(request);
        expect(await f.caller.inventory.applyTransferAssortment(request)).toEqual(applied);
        expect(await f.stable()).toEqual(before);
        expect(
          await prisma.storeProduct.count({ where: { storeId: f.destination.id, isActive: true } }),
        ).toBe(count);
        expect(
          await prisma.storeProduct.count({
            where: { storeId: f.destination.id, productId: unselected, isActive: true },
          }),
        ).toBe(0);
      },
      30_000,
    );
    it("previews without writing and atomically fills both kinds without touching identities, cost or stock", async () => {
      const f = await fixture(),
        before = await f.stable();
      const counts = await Promise.all([
        prisma.storePrice.count(),
        prisma.storeProduct.count(),
        prisma.auditLog.count(),
        prisma.idempotencyKey.count(),
      ]);
      const preview = await f.review();
      expect(preview).toMatchObject({ added: 1, priceChanges: 1 });
      expect(preview.rows[0]).toMatchObject({
        source: { retail: "120", wholesale: "90" },
        before: { retail: null, wholesale: null },
        after: { retail: "120", wholesale: "90" },
      });
      expect(
        await Promise.all([
          prisma.storePrice.count(),
          prisma.storeProduct.count(),
          prisma.auditLog.count(),
          prisma.idempotencyKey.count(),
        ]),
      ).toEqual(counts);
      const request = { change: f.change, token: preview.token, idempotencyKey: randomUUID() };
      const result = await f.caller.inventory.applyTransferAssortment(request);
      expect(await f.caller.inventory.applyTransferAssortment(request)).toEqual(result);
      expect(await f.caller.inventory.reconcileTransferAssortment(request)).toMatchObject({
        status: "APPLIED",
        added: 1,
        priceChanges: 1,
      });
      const prices = await f.prices();
      expect(Number(prices!.retailPriceKgs)).toBe(120);
      expect(Number(prices!.wholesalePriceKgs)).toBe(90);
      expect(
        (await f.caller.products.list({ storeId: f.destination.id })).items.map((p) => p.id),
      ).toEqual([f.product.id]);
      expect(await f.stable()).toEqual(before);
      expect(
        await prisma.auditLog.count({ where: { action: "TRANSFER_ASSORTMENT_PREPARE" } }),
      ).toBe(1);
      const transfer = {
        organizationId: f.org.id,
        actorId: f.adminUser.id,
        requestId: "price-test",
        fromStoreId: f.store.id,
        toStoreId: f.destination.id,
        lines: [{ productId: f.product.id, qty: 2 }],
        destinationAssortment: "REQUIRE_SALE" as const,
        idempotencyKey: randomUUID(),
      };
      await transferStock(transfer);
      await transferStock(transfer);
      expect(await prisma.stockMovement.count()).toBe(2);
      expect(
        (await prisma.inventorySnapshot.findFirstOrThrow({ where: { storeId: f.destination.id } }))
          .onHand,
      ).toBe(2);
      expect(
        (await prisma.inventorySnapshot.findFirstOrThrow({ where: { storeId: f.store.id } }))
          .onHand,
      ).toBe(8);
      expect(Number((await f.prices())!.retailPriceKgs)).toBe(120);
    });
    it("preserves explicit zero retail, discounts and source records while filling only wholesale", async () => {
      const f = await fixture();
      await prisma.storePrice.create({
        data: {
          organizationId: f.org.id,
          storeId: f.destination.id,
          productId: f.product.id,
          priceKgs: 0,
          discountType: "PERCENTAGE",
          discountPercentage: 10,
        },
      });
      await prisma.storePriceTypes.create({
        data: {
          organizationId: f.org.id,
          storeId: f.destination.id,
          productId: f.product.id,
          retailPriceKgs: 0,
        },
      });
      const before = await prisma.storePrice.findMany({ orderBy: { id: "asc" } });
      expect((await f.review()).rows[0]).toMatchObject({
        after: { retail: "0", wholesale: "90" },
        reasons: { retail: "existing", wholesale: "copy" },
      });
      await f.caller.inventory.applyTransferAssortment(await f.request());
      expect(await prisma.storePrice.findMany({ orderBy: { id: "asc" } })).toEqual(before);
      expect(Number((await f.prices())!.retailPriceKgs)).toBe(0);
      expect(Number((await f.prices())!.wholesalePriceKgs)).toBe(90);
    });
    it("copies a real zero source and leaves existing nonzero wholesale unchanged", async () => {
      const f = await fixture();
      await prisma.storePrice.updateMany({ where: { storeId: f.store.id }, data: { priceKgs: 0 } });
      await prisma.storePriceTypes.updateMany({
        where: { storeId: f.store.id },
        data: { retailPriceKgs: 0 },
      });
      await prisma.storePriceTypes.create({
        data: {
          organizationId: f.org.id,
          storeId: f.destination.id,
          productId: f.product.id,
          wholesalePriceKgs: 77,
        },
      });
      await f.caller.inventory.applyTransferAssortment(await f.request());
      expect(Number((await f.prices())!.retailPriceKgs)).toBe(0);
      expect(Number((await f.prices())!.wholesalePriceKgs)).toBe(77);
    });
    it("connects assortment only when price copying is unchecked", async () => {
      const f = await fixture(),
        before = await f.stable();
      const change = { ...f.change, prices: "NONE" as const };
      expect(await f.review(change)).toMatchObject({ added: 1, priceChanges: 0, rows: [] });
      await f.caller.inventory.applyTransferAssortment(await f.request(change));
      expect(await f.prices()).toBeNull();
      expect(await f.stable()).toEqual(before);
    });
    it("does not invent source prices and copies the global base only as a source fallback", async () => {
      const f = await fixture();
      await prisma.storePrice.deleteMany();
      await prisma.storePriceTypes.deleteMany();
      expect((await f.review()).rows[0]).toMatchObject({
        reasons: { retail: "sourceMissing", wholesale: "sourceMissing" },
      });
      await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 15 } });
      expect((await f.review()).rows[0]).toMatchObject({
        source: { retail: "15" },
        before: { retail: null },
      });
      await f.caller.inventory.applyTransferAssortment(await f.request());
      expect(Number((await f.prices())!.retailPriceKgs)).toBe(15);
      expect((await f.prices())!.wholesalePriceKgs).toBeNull();
    });
    it("copies base plus selected variants and leaves unrelated variants/products/stores alone", async () => {
      const f = await fixture();
      const variants = await Promise.all(
        ["Selected", "Unselected"].map((name) =>
          prisma.productVariant.create({ data: { productId: f.product.id, name, attributes: {} } }),
        ),
      );
      for (const v of variants)
        await prisma.storePriceTypes.create({
          data: {
            organizationId: f.org.id,
            storeId: f.store.id,
            productId: f.product.id,
            variantId: v.id,
            variantKey: v.id,
            retailPriceKgs: 45,
            wholesalePriceKgs: 30,
          },
        });
      const change = {
        ...f.change,
        lines: [{ productId: f.product.id, variantId: variants[0].id }],
      };
      expect((await f.review(change)).rows).toHaveLength(2);
      await f.caller.inventory.applyTransferAssortment(await f.request(change));
      expect(
        (await prisma.storePriceTypes.findMany({ where: { storeId: f.destination.id } }))
          .map((r) => r.variantKey)
          .sort(),
      ).toEqual(["BASE", variants[0].id].sort());
      expect(await prisma.product.count()).toBe(1);
      expect(await prisma.productVariant.count()).toBe(2);
      expect(await prisma.storePriceTypes.count({ where: { storeId: f.store.id } })).toBe(3);
    });
    it("preserves shared price bindings, including empty shared values and future inheritance", async () => {
      const f = await fixture(),
        book = await f.caller.priceBooks.create({ name: "Shared" });
      const variant = await prisma.productVariant.create({
        data: { productId: f.product.id, name: "Inherited variant", attributes: {} },
      });
      await prisma.storePriceTypes.create({
        data: {
          organizationId: f.org.id,
          storeId: f.store.id,
          productId: f.product.id,
          variantId: variant.id,
          variantKey: variant.id,
          retailPriceKgs: 45,
          wholesalePriceKgs: 30,
        },
      });
      await prisma.priceBookStoreItem.create({
        data: {
          organizationId: f.org.id,
          bookId: book.id,
          storeId: f.destination.id,
          productId: f.product.id,
          retailShared: true,
          wholesaleShared: true,
        },
      });
      const bindings = await prisma.priceBookStoreItem.findMany();
      const change = { ...f.change, lines: [{ productId: f.product.id, variantId: variant.id }] };
      const p = await f.review(change);
      expect(p.priceChanges).toBe(0);
      for (const r of p.rows) expect(r.reasons).toEqual({ retail: "shared", wholesale: "shared" });
      await f.caller.inventory.applyTransferAssortment(await f.request(change));
      expect(await f.prices()).toBeNull();
      expect(await prisma.priceBookStoreItem.findMany()).toEqual(bindings);
    });
    it("copies only retail when wholesale mode is off", async () => {
      const f = await fixture();
      await prisma.organization.update({
        where: { id: f.org.id },
        data: { retailWholesaleEnabled: false },
      });
      expect(await f.review()).toMatchObject({ retailWholesaleEnabled: false });
      await f.caller.inventory.applyTransferAssortment(await f.request());
      expect(await f.prices()).toBeNull();
      expect(
        Number(
          (await prisma.storePrice.findFirstOrThrow({ where: { storeId: f.destination.id } }))
            .priceKgs,
        ),
      ).toBe(120);
    });
    it.each(["source", "target", "product"])(
      "rejects stale %s data without partial changes",
      async (kind) => {
        const f = await fixture(),
          request = await f.request();
        if (kind === "source")
          await prisma.storePriceTypes.updateMany({
            where: { storeId: f.store.id },
            data: { retailPriceKgs: 121 },
          });
        if (kind === "target")
          await prisma.storePriceTypes.create({
            data: {
              organizationId: f.org.id,
              storeId: f.destination.id,
              productId: f.product.id,
              retailPriceKgs: 88,
            },
          });
        if (kind === "product")
          await prisma.product.update({ where: { id: f.product.id }, data: { name: "Changed" } });
        await expect(f.caller.inventory.applyTransferAssortment(request)).rejects.toMatchObject({
          message: "transferPreparationStale",
        });
        expect(
          await prisma.storeProduct.count({ where: { storeId: f.destination.id, isActive: true } }),
        ).toBe(0);
        expect(
          await prisma.auditLog.count({ where: { action: "TRANSFER_ASSORTMENT_PREPARE" } }),
        ).toBe(0);
      },
    );
    it("rolls back assortment and prices together when the final audit fails", async () => {
      const f = await fixture(),
        request = await f.request();
      const original = audit.writeAuditLog;
      const spy = vi.spyOn(audit, "writeAuditLog").mockImplementation(async (tx, input) => {
        if (input.action === "TRANSFER_ASSORTMENT_PREPARE") throw new Error("audit unavailable");
        return original(tx, input);
      });
      try {
        await expect(f.caller.inventory.applyTransferAssortment(request)).rejects.toThrow();
      } finally {
        spy.mockRestore();
      }
      expect(await f.prices()).toBeNull();
      expect(
        await prisma.storeProduct.count({ where: { storeId: f.destination.id, isActive: true } }),
      ).toBe(0);
      await f.caller.inventory.applyTransferAssortment(request);
      expect(Number((await f.prices())!.retailPriceKgs)).toBe(120);
    });
    it("closes uncommitted attempts so a late original cannot apply after reconciliation", async () => {
      const f = await fixture(),
        request = await f.request();
      expect(await f.caller.inventory.reconcileTransferAssortment(request)).toEqual({
        status: "CANCELED",
      });
      await expect(f.caller.inventory.applyTransferAssortment(request)).rejects.toMatchObject({
        message: "transferPreparationAttemptClosed",
      });
      expect(await f.prices()).toBeNull();
      await f.caller.inventory.applyTransferAssortment(await f.request());
      expect(Number((await f.prices())!.retailPriceKgs)).toBe(120);
    });
    it("rejects token tampering, altered payloads and unrelated variants", async () => {
      const f = await fixture(),
        request = await f.request();
      await expect(
        f.caller.inventory.applyTransferAssortment({
          ...request,
          change: { ...f.change, prices: "NONE" },
        }),
      ).rejects.toMatchObject({ message: "transferPreparationStale" });
      await expect(
        f.caller.inventory.applyTransferAssortment({ ...request, token: request.token + "x" }),
      ).rejects.toMatchObject({ message: "transferPreparationStale" });
      await expect(
        f.review({ ...f.change, lines: [{ productId: f.product.id, variantId: "unknown" }] }),
      ).rejects.toMatchObject({ message: "variantMismatch" });
      expect(await f.prices()).toBeNull();
    });
    it("freshly enforces role, organization, store access and subscription", async () => {
      const f = await fixture(),
        request = await f.request();
      for (const user of [f.managerUser, f.staffUser]) {
        const caller = createTestCaller({ ...user, organizationId: f.org.id });
        await expect(caller.inventory.previewTransferAssortment(f.change)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(caller.inventory.applyTransferAssortment(request)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }
      const other = await prisma.organization.create({ data: { name: "Other" } }),
        store = await prisma.store.create({
          data: { organizationId: other.id, name: "Other", code: "OTHER" },
        });
      await expect(f.review({ ...f.change, toStoreId: store.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await prisma.user.update({
        where: { id: f.adminUser.id },
        data: { role: "STAFF", isOrgOwner: false },
      });
      await expect(f.caller.inventory.applyTransferAssortment(request)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await prisma.user.update({
        where: { id: f.adminUser.id },
        data: { role: "ADMIN", isOrgOwner: true },
      });
      await prisma.organization.update({
        where: { id: f.org.id },
        data: { subscriptionStatus: "CANCELED" },
      });
      await expect(f.caller.inventory.applyTransferAssortment(request)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(await f.prices()).toBeNull();
    });
    it("never reopens locally hidden cards", async () => {
      const f = await fixture();
      await prisma.storeProduct.create({
        data: {
          organizationId: f.org.id,
          storeId: f.destination.id,
          productId: f.product.id,
          isDirect: true,
          isHidden: true,
          isActive: false,
        },
      });
      await expect(f.review()).rejects.toMatchObject({ message: "assortmentUseSourceEditor" });
      expect(await f.prices()).toBeNull();
    });
    it("takes prices from the actual sending warehouse rather than the original product catalog", async () => {
      const f = await fixture(),
        warehouse = await prisma.store.create({
          data: { organizationId: f.org.id, name: "Intermediate", code: "MID" },
        });
      const config = (await f.caller.stores.catalogSettings({ storeId: warehouse.id })).settings!;
      config.connections.push({
        key: `store:${f.store.id}`,
        enabled: true,
        scope: "ALL",
        productIds: [],
      });
      await f.caller.stores.saveCatalogSettings({
        change: config,
        token: (await f.caller.stores.previewCatalogSettings(config)).token,
        idempotencyKey: randomUUID(),
      });
      await prisma.storePriceTypes.create({
        data: {
          organizationId: f.org.id,
          storeId: warehouse.id,
          productId: f.product.id,
          retailPriceKgs: 160,
          wholesalePriceKgs: 140,
        },
      });
      await f.caller.inventory.applyTransferAssortment(
        await f.request({ ...f.change, fromStoreId: warehouse.id }),
      );
      expect(Number((await f.prices())!.retailPriceKgs)).toBe(160);
      expect(Number((await f.prices())!.wholesalePriceKgs)).toBe(140);
    });
    it("handles concurrent duplicate requests with one atomic result", async () => {
      const f = await fixture(),
        request = await f.request();
      const results = await Promise.all([
        f.caller.inventory.applyTransferAssortment(request),
        f.caller.inventory.applyTransferAssortment(request),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(
        await prisma.auditLog.count({ where: { action: "TRANSFER_ASSORTMENT_PREPARE" } }),
      ).toBe(1);
    });

    it("keeps the store-pricing plan gate while allowing assortment-only preparation", async () => {
      const f = await fixture();
      await prisma.organization.update({ where: { id: f.org.id }, data: { plan: "STARTER" } });
      expect(
        await f.caller.inventory.transferAssortmentOptions({
          fromStoreId: f.store.id,
          toStoreId: f.destination.id,
          productIds: [f.product.id],
        }),
      ).toMatchObject({ pricingAllowed: false });
      await expect(f.review()).rejects.toMatchObject({ message: "featureLockedStorePrices" });
      await f.caller.inventory.applyTransferAssortment(
        await f.request({ ...f.change, prices: "NONE" }),
      );
      expect(await f.prices()).toBeNull();
    });
    it("handles all 500 selected products in bounded batches without reopening unselected catalog items", async () => {
      const f = await fixture();
      const ids = Array.from({ length: 499 }, () => randomUUID());
      await prisma.product.createMany({
        data: ids.map((id, i) => ({
          id,
          organizationId: f.org.id,
          sku: `BATCH-${i}`,
          name: `Batch ${i}`,
          unit: f.baseUnit.code,
          baseUnitId: f.baseUnit.id,
        })),
      });
      await prisma.storeProduct.createMany({
        data: ids.map((productId) => ({
          organizationId: f.org.id,
          storeId: f.store.id,
          productId,
          isDirect: true,
        })),
      });
      await prisma.storePriceTypes.createMany({
        data: ids.map((productId) => ({
          organizationId: f.org.id,
          storeId: f.store.id,
          productId,
          retailPriceKgs: 20,
          wholesalePriceKgs: 10,
        })),
      });
      const change = {
        ...f.change,
        selections: [
          ...f.change.selections,
          ...ids.map((productId) => ({ productId, sourceKey: `store:${f.store.id}` })),
        ],
        lines: [...f.change.lines, ...ids.map((productId) => ({ productId }))],
      };
      const p = await f.review(change);
      expect(p.priceChanges).toBe(500);
      expect(p.added).toBe(500);
      await f.caller.inventory.applyTransferAssortment({
        change,
        token: p.token,
        idempotencyKey: randomUUID(),
      });
      expect(await prisma.storePriceTypes.count({ where: { storeId: f.destination.id } })).toBe(
        500,
      );
      expect(await prisma.storePrice.count({ where: { storeId: f.destination.id } })).toBe(500);
      expect(await prisma.stockMovement.count()).toBe(0);
      expect(await prisma.inventorySnapshot.count()).toBe(1);
    });
    it("serializes reconciliation against a late apply with no partial state", async () => {
      const f = await fixture(),
        request = await f.request();
      const [applied, checked] = await Promise.allSettled([
        f.caller.inventory.applyTransferAssortment(request),
        f.caller.inventory.reconcileTransferAssortment(request),
      ]);
      expect(checked.status).toBe("fulfilled");
      if (checked.status === "fulfilled" && checked.value.status === "CANCELED") {
        expect(applied.status).toBe("rejected");
        expect(await f.prices()).toBeNull();
        expect(
          await prisma.storeProduct.count({ where: { storeId: f.destination.id, isActive: true } }),
        ).toBe(0);
      } else {
        expect(applied.status).toBe("fulfilled");
        expect(Number((await f.prices())!.retailPriceKgs)).toBe(120);
      }
    });
    it("recovers committed receipts after the preview expires", async () => {
      const f = await fixture(),
        request = await f.request();
      await f.caller.inventory.applyTransferAssortment(request);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 11 * 60_000);
      try {
        expect(await f.caller.inventory.reconcileTransferAssortment(request)).toMatchObject({
          status: "APPLIED",
        });
      } finally {
        vi.useRealTimers();
      }
    });
  },
);
