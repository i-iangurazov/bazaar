import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const db = shouldRunDbTests ? describe : describe.skip;
db("shared selling price books", () => {
  beforeEach(resetDatabase);
  async function fixture() {
    const f = await seedBase({ plan: "BUSINESS", allowNegativeStock: true });
    await prisma.organization.update({
      where: { id: f.org.id },
      data: { retailWholesaleEnabled: true },
    });
    const second = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Second", code: "SEC", allowNegativeStock: true },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: f.org.id,
        storeId: second.id,
        productId: f.product.id,
        isActive: true,
      },
    });
    const admin = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const book = await admin.priceBooks.create({ name: "Common" });
    async function apply(
      change: Parameters<typeof admin.priceBooks.preview>[0]["change"],
      id = crypto.randomUUID(),
    ) {
      const p = await admin.priceBooks.preview({ bookId: book.id, change });
      const request = { bookId: book.id, change, token: p.token, idempotencyKey: id };
      const result = await admin.priceBooks.publish(request);
      return { p, result, request };
    }
    const prices = (retail: number, wholesale: number | null = 80) => ({
      kind: "PRICES" as const,
      entries: [{ productId: f.product.id, retailPriceKgs: retail, wholesalePriceKgs: wholesale }],
    });
    const read = (storeId: string) =>
      prisma.storePrice.findFirstOrThrow({ where: { storeId, productId: f.product.id } });
    return { ...f, second, admin, book, apply, prices, read };
  }

  it("does not change old stores before explicit connection; preserves zero and local prices, then follows common updates", async () => {
    const f = await fixture();
    await f.admin.storePrices.upsert({ storeId: f.store.id, productId: f.product.id, priceKgs: 0 });
    await f.apply(f.prices(100));
    expect(Number((await f.read(f.store.id)).priceKgs)).toBe(0);
    expect(await prisma.storePrice.count({ where: { storeId: f.second.id } })).toBe(0);
    const connected = await f.apply({
      kind: "CONNECT",
      storeIds: [f.store.id, f.second.id],
      preserveLocal: true,
    });
    expect(connected.p.stores.find((s) => s.id === f.second.id)?.changedPositions).toBe(1);
    expect(Number((await f.read(f.store.id)).priceKgs)).toBe(0);
    expect(Number((await f.read(f.second.id)).priceKgs)).toBe(100);
    await f.apply(f.prices(120, 90));
    expect(Number((await f.read(f.store.id)).priceKgs)).toBe(0);
    expect(Number((await f.read(f.second.id)).priceKgs)).toBe(120);
    const list = await f.admin.products.list({ storeId: f.second.id, sortKey: "salePrice" });
    expect(list.items.find((p) => p.id === f.product.id)?.effectivePriceKgs).toBe(120);
    const pricing = await f.admin.products.storePricing({ productId: f.product.id });
    expect(pricing.stores.find((s) => s.storeId === f.second.id)).toMatchObject({
      effectivePriceKgs: 120,
      wholesalePriceKgs: 90,
    });
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it("local edits leave only that kind; same-value, discount-only and unrelated field writes retain inheritance", async () => {
    const f = await fixture();
    await f.apply(f.prices(100));
    await f.apply({ kind: "CONNECT", storeIds: [f.store.id], preserveLocal: false });
    await f.admin.storePrices.upsert({
      storeId: f.store.id,
      productId: f.product.id,
      priceKgs: 100,
    });
    await prisma.storePrice.updateMany({
      where: { storeId: f.store.id },
      data: { discountType: "PERCENTAGE", discountPercentage: 5 },
    });
    expect(await prisma.priceBookStoreItem.findFirst()).toMatchObject({
      retailShared: true,
      wholesaleShared: true,
    });
    await f.admin.storePrices.upsert({
      storeId: f.store.id,
      productId: f.product.id,
      priceKgs: 115,
    });
    expect(await prisma.priceBookStoreItem.findFirst()).toMatchObject({
      retailShared: false,
      wholesaleShared: true,
    });
    await f.apply(f.prices(130, 95));
    expect(Number((await f.read(f.store.id)).priceKgs)).toBe(115);
    expect(Number((await prisma.storePriceTypes.findFirstOrThrow()).wholesalePriceKgs)).toBe(95);
    expect(Number((await f.read(f.store.id)).discountPercentage)).toBe(5);
    await f.apply({
      kind: "SOURCE",
      storeIds: [f.store.id],
      productId: f.product.id,
      retailShared: true,
      wholesaleShared: true,
    });
    expect(Number((await f.read(f.store.id)).priceKgs)).toBe(130);
  });

  it("rejects stale, changed-scope and cross-actor previews, and replays a publication once", async () => {
    const f = await fixture();
    await f.apply(f.prices(100));
    await f.apply({ kind: "CONNECT", storeIds: [f.store.id], preserveLocal: false });
    const change = f.prices(150),
      preview = await f.admin.priceBooks.preview({ bookId: f.book.id, change });
    await f.admin.storePrices.upsert({
      storeId: f.store.id,
      productId: f.product.id,
      priceKgs: 105,
    });
    await expect(
      f.admin.priceBooks.publish({
        bookId: f.book.id,
        change,
        token: preview.token,
        idempotencyKey: "stale-preview-check",
      }),
    ).rejects.toThrow("priceBookPreviewStale");
    expect(Number((await f.read(f.store.id)).priceKgs)).toBe(105);
    const p = await f.admin.priceBooks.preview({ bookId: f.book.id, change });
    await expect(
      f.admin.priceBooks.publish({
        bookId: f.book.id,
        change: f.prices(999),
        token: p.token,
        idempotencyKey: "scope-preview-check",
      }),
    ).rejects.toThrow("priceBookPreviewStale");
    const result = await f.apply(change);
    expect(await f.admin.priceBooks.publish(result.request)).toEqual(result.result);
    expect(await prisma.priceBookChange.count({ where: { id: result.result.changeId } })).toBe(1);
    await expect(
      f.admin.priceBooks.publish({ ...result.request, change: f.prices(900) }),
    ).rejects.toThrow("idempotencyKeyPayloadMismatch");
  });

  it("rolls back an exact publication, including originally absent prices; refuses to overwrite later individual edits", async () => {
    const f = await fixture();
    await f.apply(f.prices(100));
    const connected = await f.apply({
      kind: "CONNECT",
      storeIds: [f.store.id],
      preserveLocal: false,
    });
    await f.apply({ kind: "ROLLBACK", changeId: connected.result.changeId });
    expect(await prisma.storePrice.count()).toBe(0);
    expect(await prisma.storePriceTypes.count()).toBe(0);
    expect(await prisma.priceBookStore.count()).toBe(0);
    await f.apply({ kind: "CONNECT", storeIds: [f.store.id], preserveLocal: false });
    const updated = await f.apply(f.prices(200, 120));
    await f.apply({ kind: "ROLLBACK", changeId: updated.result.changeId });
    expect(Number((await f.read(f.store.id)).priceKgs)).toBe(100);
    const latest = await f.apply(f.prices(250, 130));
    await f.admin.storePrices.upsert({
      storeId: f.store.id,
      productId: f.product.id,
      priceKgs: 299,
    });
    await expect(
      f.admin.priceBooks.preview({
        bookId: f.book.id,
        change: { kind: "ROLLBACK", changeId: latest.result.changeId },
      }),
    ).rejects.toThrow("priceBookRollbackConflict");
    expect(Number((await f.read(f.store.id)).priceKgs)).toBe(299);
  });

  it("keeps POS draft amounts and effective wholesale selection consistent; disconnect freezes last prices", async () => {
    const f = await fixture();
    await f.apply(f.prices(100));
    await f.apply({ kind: "CONNECT", storeIds: [f.store.id], preserveLocal: false });
    const register = await f.admin.pos.registers.create({
      storeId: f.store.id,
      name: "Common",
      code: "COMMON",
    });
    await f.admin.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "common-price-shift",
    });
    const old = await f.admin.pos.sales.createDraft({
      registerId: register.id,
      priceMode: "RETAIL",
      lines: [{ productId: f.product.id, qty: 2 }],
    });
    await f.apply(f.prices(150, 90));
    expect(
      Number((await prisma.customerOrder.findUniqueOrThrow({ where: { id: old.id } })).totalKgs),
    ).toBe(200);
    await f.admin.pos.sales.cancelDraft({ saleId: old.id });
    const next = await f.admin.pos.sales.createDraft({
      registerId: register.id,
      priceMode: "WHOLESALE",
      lines: [{ productId: f.product.id, qty: 2 }],
    });
    expect(
      Number((await prisma.customerOrder.findUniqueOrThrow({ where: { id: next.id } })).totalKgs),
    ).toBe(180);
    await f.apply({ kind: "DISCONNECT", storeIds: [f.store.id] });
    await f.apply(f.prices(300, 200));
    expect(Number((await f.read(f.store.id)).priceKgs)).toBe(150);
  });

  it("comparison is read-only, separates missing from zero and matches immutable IDs", async () => {
    const f = await fixture();
    await f.admin.storePrices.upsert({
      storeId: f.store.id,
      productId: f.product.id,
      priceKgs: 100,
    });
    await f.admin.storePrices.upsert({
      storeId: f.second.id,
      productId: f.product.id,
      priceKgs: 0,
    });
    const before = await prisma.storePrice.findMany({ orderBy: { id: "asc" } });
    const c = await f.admin.priceBooks.compare({
      sourceId: f.store.id,
      targetId: f.second.id,
      page: 1,
      onlyDifferences: true,
    });
    expect(c.readOnly).toBe(true);
    expect(c.counts).toEqual({ total: 1, different: 1, missingTarget: 0, zeroTarget: 1 });
    expect(c.rows[0].productId).toBe(f.product.id);
    expect(Number(c.rows[0].targetExplicitRetail)).toBe(0);
    expect(await prisma.storePrice.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    expect(await prisma.priceBookChange.count()).toBe(0);
  });

  it("enforces role, organization, store, plan and variant scope at the API and database boundaries", async () => {
    const f = await fixture();
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    await expect(manager.priceBooks.list()).rejects.toThrow("forbidden");
    const other = await prisma.organization.create({ data: { name: "Other", plan: "BUSINESS" } });
    const otherStore = await prisma.store.create({
      data: { organizationId: other.id, name: "Other", code: "OTHER" },
    });
    await expect(
      f.apply({ kind: "CONNECT", storeIds: [otherStore.id], preserveLocal: true }),
    ).rejects.toThrow("priceBookScopeMismatch");
    await expect(
      f.apply({
        kind: "PRICES",
        entries: [
          {
            productId: f.product.id,
            variantId: "wrong-variant",
            retailPriceKgs: 1,
            wholesalePriceKgs: null,
          },
        ],
      }),
    ).rejects.toThrow("priceBookScopeMismatch");
    await expect(
      prisma.priceBookStore.create({
        data: { organizationId: f.org.id, bookId: f.book.id, storeId: otherStore.id },
      }),
    ).rejects.toThrow("priceBookScopeMismatch");
    await prisma.organization.update({ where: { id: f.org.id }, data: { plan: "STARTER" } });
    await expect(f.admin.priceBooks.list()).rejects.toThrow("featureLockedStorePrices");
  });
  it("prepares bulk changes with decimal rounding and stale-version protection, without writing", async () => {
    const f = await fixture();
    await f.apply(f.prices(139.5));
    const count = await prisma.priceBookChange.count();
    const draft = await f.admin.priceBooks.prepareBulk({
      bookId: f.book.id,
      kind: "RETAIL",
      mode: "PERCENT",
      value: 5,
    });
    expect(draft.entries[0].retailPriceKgs).toBe(146.48);
    expect(await prisma.priceBookChange.count()).toBe(count);
    await f.apply(f.prices(150));
    await expect(f.admin.priceBooks.preview({ bookId: f.book.id, change: draft })).rejects.toThrow(
      "priceBookPreviewStale",
    );
    await expect(
      f.admin.priceBooks.prepareBulk({
        bookId: f.book.id,
        kind: "RETAIL",
        mode: "AMOUNT",
        value: -1000,
      }),
    ).rejects.toThrow("priceBookAmountInvalid");
  });

  it("keeps archived products and inactive variants frozen during bulk preparation", async () => {
    const f = await fixture();
    const archived = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        name: "Archived position",
        sku: "ARCHIVED-PRICE",
        unit: f.baseUnit.code,
        baseUnitId: f.baseUnit.id,
        basePriceKgs: 120,
      },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: f.product.id, name: "Inactive later", attributes: {} },
    });
    await f.apply({
      kind: "PRICES",
      entries: [
        { productId: f.product.id, retailPriceKgs: 100, wholesalePriceKgs: null },
        { productId: archived.id, retailPriceKgs: 120, wholesalePriceKgs: null },
        {
          productId: f.product.id,
          variantId: variant.id,
          retailPriceKgs: 110,
          wholesalePriceKgs: null,
        },
      ],
    });
    await prisma.product.update({ where: { id: archived.id }, data: { isDeleted: true } });
    await prisma.productVariant.update({ where: { id: variant.id }, data: { isActive: false } });
    const prepared = await f.admin.priceBooks.prepareBulk({
      bookId: f.book.id,
      kind: "RETAIL",
      mode: "PERCENT",
      value: 10,
    });
    expect(prepared.entries).toEqual([
      { productId: f.product.id, variantId: null, retailPriceKgs: 110, wholesalePriceKgs: null },
    ]);
    await f.apply(prepared);
    expect(
      Number(
        (await prisma.priceBookEntry.findFirstOrThrow({ where: { productId: archived.id } }))
          .retailPriceKgs,
      ),
    ).toBe(120);
    expect(
      Number(
        (await prisma.priceBookEntry.findFirstOrThrow({ where: { variantKey: variant.id } }))
          .retailPriceKgs,
      ),
    ).toBe(110);
  });

  it("prepares source prices without replacing existing entries by default; keeps missing separate from zero", async () => {
    const f = await fixture();
    await f.admin.storePrices.upsert({ storeId: f.store.id, productId: f.product.id, priceKgs: 0 });
    const before = await prisma.storePrice.findMany();
    const draft = await f.admin.priceBooks.prepareFromStore({
      bookId: f.book.id,
      sourceId: f.store.id,
      replaceExisting: false,
    });
    expect(draft.change.entries[0].retailPriceKgs).toBe(0);
    expect(await prisma.storePrice.findMany()).toEqual(before);
    expect(await prisma.priceBookEntry.count()).toBe(0);
    await f.apply(draft.change);
    await expect(
      f.admin.priceBooks.prepareFromStore({
        bookId: f.book.id,
        sourceId: f.store.id,
        replaceExisting: false,
      }),
    ).rejects.toThrow("priceBookEmptySelection");
    expect(Number((await prisma.priceBookEntry.findFirstOrThrow()).retailPriceKgs)).toBe(0);
  });

  it("preserves inheritance on metadata-only product saves and independent stock/assortment; removing a row freezes prices", async () => {
    const f = await fixture();
    await f.apply(f.prices(100));
    await f.apply({ kind: "CONNECT", storeIds: [f.store.id], preserveLocal: false });
    const assignments = await prisma.storeProduct.findMany();
    await f.admin.products.update({
      productId: f.product.id,
      storeId: f.store.id,
      sku: f.product.sku,
      name: "Description changed",
      baseUnitId: f.baseUnit.id,
    });
    expect(await prisma.priceBookStoreItem.findFirst()).toMatchObject({
      retailShared: true,
      wholesaleShared: true,
    });
    await f.apply(f.prices(120));
    expect(Number((await f.read(f.store.id)).priceKgs)).toBe(120);
    await f.apply(f.prices(120, null));
    expect(await prisma.priceBookStoreItem.findFirst()).toMatchObject({
      retailShared: true,
      wholesaleShared: false,
    });
    expect(Number((await prisma.storePriceTypes.findFirstOrThrow()).wholesalePriceKgs)).toBe(80);
    await f.apply({ kind: "REMOVE", entries: [{ productId: f.product.id }] });
    expect(await prisma.priceBookEntry.count()).toBe(0);
    expect(await prisma.priceBookStoreItem.count()).toBe(0);
    expect(Number((await f.read(f.store.id)).priceKgs)).toBe(120);
    expect(await prisma.storeProduct.findMany()).toEqual(assignments);
    expect(await prisma.inventorySnapshot.count()).toBe(0);
  });

  it("handles variants and store currency without changing financial units; rejects another administrator's token", async () => {
    const f = await fixture();
    const variant = await prisma.productVariant.create({
      data: { productId: f.product.id, name: "XL", attributes: {} },
    });
    await prisma.store.update({
      where: { id: f.store.id },
      data: { currencyCode: "USD", currencyRateKgsPerUnit: 87 },
    });
    await f.apply({
      kind: "PRICES",
      entries: [
        {
          productId: f.product.id,
          variantId: variant.id,
          retailPriceKgs: 174,
          wholesalePriceKgs: 87,
        },
      ],
    });
    const assignmentCount = await prisma.storeProduct.count();
    await f.apply({ kind: "CONNECT", storeIds: [f.store.id], preserveLocal: false });
    const price = await prisma.storePrice.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(Number(price.priceKgs)).toBe(174);
    expect(await prisma.storeProduct.count()).toBe(assignmentCount);
    const another = await prisma.user.create({
      data: {
        organizationId: f.org.id,
        email: "another-admin@test.local",
        role: "ADMIN",
        name: "Another",
        passwordHash: "hash",
        emailVerifiedAt: new Date(),
      },
    });
    const caller = createTestCaller({ ...another, organizationId: f.org.id });
    const change = { kind: "DISCONNECT" as const, storeIds: [f.store.id] },
      preview = await f.admin.priceBooks.preview({ bookId: f.book.id, change });
    await expect(
      caller.priceBooks.publish({
        bookId: f.book.id,
        change,
        token: preview.token,
        idempotencyKey: "cross-actor-price-book",
      }),
    ).rejects.toThrow("priceBookPreviewStale");
  });

  it("serializes concurrent list publication and individual pricing without losing the accepted individual edit", async () => {
    const f = await fixture();
    await f.apply(f.prices(100));
    await f.apply({ kind: "CONNECT", storeIds: [f.store.id], preserveLocal: false });
    const change = f.prices(120),
      preview = await f.admin.priceBooks.preview({ bookId: f.book.id, change });
    const result = await Promise.allSettled([
      f.admin.priceBooks.publish({
        bookId: f.book.id,
        change,
        token: preview.token,
        idempotencyKey: "concurrent-price-book",
      }),
      f.admin.storePrices.upsert({ storeId: f.store.id, productId: f.product.id, priceKgs: 135 }),
    ]);
    if (result[1].status === "rejected")
      await f.admin.storePrices.upsert({
        storeId: f.store.id,
        productId: f.product.id,
        priceKgs: 135,
      });
    expect(Number((await f.read(f.store.id)).priceKgs)).toBe(135);
    expect(await prisma.priceBookStoreItem.findFirst()).toMatchObject({ retailShared: false });
    expect(await prisma.priceBookChange.count({ where: { kind: "PRICES" } })).toBe(
      result[0].status === "fulfilled" ? 2 : 1,
    );
  });
  it("reconciles a lost publication response and closes an unposted attempt before any late request", async () => {
    const f = await fixture();
    const posted = await f.apply(f.prices(100));
    expect(await f.admin.priceBooks.reconcile(posted.request)).toEqual({
      status: "POSTED",
      changeId: posted.result.changeId,
    });
    const change = f.prices(120),
      preview = await f.admin.priceBooks.preview({ bookId: f.book.id, change });
    const request = {
      bookId: f.book.id,
      change,
      token: preview.token,
      idempotencyKey: "unposted-price-attempt",
    };
    expect(await f.admin.priceBooks.reconcile(request)).toEqual({ status: "CANCELED" });
    await expect(f.admin.priceBooks.publish(request)).rejects.toThrow("priceBookAttemptClosed");
    expect(Number((await prisma.priceBookEntry.findFirstOrThrow()).retailPriceKgs)).toBe(100);
    expect(await prisma.priceBookChange.count()).toBe(1);
  });

  it("resolves a reconciliation/publication race to one terminal result", async () => {
    const f = await fixture();
    await f.apply(f.prices(100));
    const change = f.prices(120),
      preview = await f.admin.priceBooks.preview({ bookId: f.book.id, change });
    const request = {
      bookId: f.book.id,
      change,
      token: preview.token,
      idempotencyKey: "racing-price-attempt",
    };
    const results = await Promise.allSettled([
      f.admin.priceBooks.publish(request),
      f.admin.priceBooks.reconcile(request),
    ]);
    const resolved = await f.admin.priceBooks.reconcile(request);
    if (resolved.status === "CANCELED") {
      expect(Number((await prisma.priceBookEntry.findFirstOrThrow()).retailPriceKgs)).toBe(100);
      await expect(f.admin.priceBooks.publish(request)).rejects.toThrow("priceBookAttemptClosed");
    } else {
      expect(Number((await prisma.priceBookEntry.findFirstOrThrow()).retailPriceKgs)).toBe(120);
      expect((await f.admin.priceBooks.publish(request)).changeId).toBe(resolved.changeId);
    }
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  });
});
