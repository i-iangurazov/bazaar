import { describe, expect, it } from "vitest";
import {
  replayStoreStockValuation,
  storeStockValuationKey,
  type StoreStockValuationMovement,
  type StoreStockValuationSnapshot,
} from "@/lib/inventory/storeStockValuation";

const row = (
  index: number,
  patch: Partial<StoreStockValuationMovement> = {},
): StoreStockValuationMovement => ({
  id: `m${String(index).padStart(4, "0")}`,
  storeId: "a",
  productId: "p",
  variantId: null,
  type: "RECEIVE",
  qtyDelta: 10,
  unitCostKgs: "100",
  lineTotalKgs: null,
  referenceType: "STOCK_RECEIVING",
  referenceId: `receipt${index}`,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  ...patch,
});
function run(
  movements: StoreStockValuationMovement[],
  options: {
    snapshots?: StoreStockValuationSnapshot[];
    quantity?: number;
    cost?: number;
    movementDate?: Date;
    truncated?: boolean;
    variantId?: string | null;
  } = {},
) {
  const variantId = options.variantId ?? null;
  const balances = new Map<string, number>();
  for (const movement of movements) {
    const key = JSON.stringify([movement.storeId, movement.productId, movement.variantId]);
    balances.set(key, Number(((balances.get(key) ?? 0) + movement.qtyDelta).toFixed(3)));
  }
  const snapshots =
    options.snapshots ??
    [...balances].map(([key, onHand]) => {
      const [storeId, productId, variantId] = JSON.parse(key) as [string, string, string | null];
      return { storeId, productId, variantId, onHand };
    });
  return replayStoreStockValuation({
    storeId: "a",
    lines: [
      {
        productId: "p",
        variantId,
        quantity: options.quantity ?? 10,
        unitCost: options.cost ?? 200,
      },
    ],
    movements,
    snapshots,
    movementDate: options.movementDate,
    now: new Date("2026-11-10T12:00:00Z"),
    truncatedKeys: options.truncated
      ? new Set([storeStockValuationKey("p", variantId)])
      : undefined,
  })[0];
}

describe("evidenced store-stock reference valuation", () => {
  it("weights the remaining old stock rather than all historic purchased units", () => {
    const result = run([
      row(1, { qtyDelta: 100 }),
      row(2, {
        type: "SALE",
        qtyDelta: -90,
        unitCostKgs: null,
        referenceType: "CustomerOrder",
        referenceId: "s1",
      }),
    ]);
    expect(result.current).toEqual({
      quantity: 10,
      unitCostKgs: 100,
      status: "KNOWN",
      reason: null,
    });
    expect(result.projected).toEqual({
      quantity: 20,
      unitCostKgs: 150,
      status: "KNOWN",
      reason: null,
    });
  });
  it("replays the posted receipt to the same current cost that was previewed", () => {
    const old = [
      row(1, { qtyDelta: 100 }),
      row(2, { type: "SALE", qtyDelta: -90, unitCostKgs: null }),
    ];
    const preview = run(old).projected;
    const posted = run([...old, row(3, { qtyDelta: 10, unitCostKgs: "200" })]).current;
    expect(posted).toEqual(preview);
  });
  it("keeps costs scoped by variant and selected store", () => {
    const result = run(
      [
        row(1, { variantId: "v", unitCostKgs: "50" }),
        row(2, { storeId: "b", variantId: "v", unitCostKgs: "900" }),
        row(3, { unitCostKgs: "700" }),
      ],
      { variantId: "v", cost: 100 },
    );
    expect(result.current.unitCostKgs).toBe(50);
    expect(result.projected.unitCostKgs).toBe(75);
    expect(result).not.toHaveProperty("movements");
  });
  it("transfers the source's evidenced value without treating the global recorded cost as local AVCO", () => {
    const result = run([
      row(1, { storeId: "b", unitCostKgs: "100" }),
      row(2, { unitCostKgs: "200" }),
      row(3, {
        storeId: "b",
        type: "TRANSFER_OUT",
        qtyDelta: -10,
        unitCostKgs: "999",
        referenceType: "TRANSFER",
        referenceId: "t1",
      }),
      row(4, {
        type: "TRANSFER_IN",
        qtyDelta: 10,
        unitCostKgs: null,
        referenceType: "TRANSFER",
        referenceId: "t1",
      }),
    ]);
    expect(result.current).toMatchObject({ quantity: 20, unitCostKgs: 150, status: "KNOWN" });
  });
  it("supports a multi-store transfer chain", () => {
    const result = run([
      row(1, { storeId: "c", qtyDelta: 20, unitCostKgs: "60" }),
      row(2, {
        storeId: "c",
        type: "TRANSFER_OUT",
        qtyDelta: -10,
        referenceType: "TRANSFER",
        referenceId: "t1",
      }),
      row(3, {
        storeId: "b",
        type: "TRANSFER_IN",
        qtyDelta: 10,
        unitCostKgs: null,
        referenceType: "TRANSFER",
        referenceId: "t1",
      }),
      row(4, {
        storeId: "b",
        type: "TRANSFER_OUT",
        qtyDelta: -5,
        referenceType: "TRANSFER",
        referenceId: "t2",
      }),
      row(5, {
        type: "TRANSFER_IN",
        qtyDelta: 5,
        unitCostKgs: null,
        referenceType: "TRANSFER",
        referenceId: "t2",
      }),
    ]);
    expect(result.current).toMatchObject({ quantity: 5, unitCostKgs: 60, status: "KNOWN" });
  });
  it("uses the replayed original sale cost for a return after prices have changed", () => {
    const result = run([
      row(1),
      row(2, {
        type: "SALE",
        qtyDelta: -5,
        referenceType: "CustomerOrder",
        referenceId: "sale",
        unitCostKgs: "999",
      }),
      row(3, { qtyDelta: 10, unitCostKgs: "200" }),
      row(4, {
        type: "RETURN",
        qtyDelta: 5,
        unitCostKgs: null,
        referenceType: "SaleReturn",
        referenceId: "ret",
        originalSaleId: "sale",
      }),
    ]);
    expect(result.current).toMatchObject({ quantity: 20, unitCostKgs: 150, status: "KNOWN" });
  });
  it("does not invent a return cost when original sale provenance is missing", () => {
    const result = run([
      row(1),
      row(2, {
        type: "RETURN",
        qtyDelta: 2,
        unitCostKgs: "999",
        referenceType: "SaleReturn",
        referenceId: "ret",
        originalSaleId: "absent",
      }),
    ]);
    expect(result.current).toMatchObject({
      unitCostKgs: null,
      status: "UNKNOWN",
      reason: "MISSING_RETURN",
    });
  });
  it("does not attach another store's sale cost to a legacy cross-store return", () => {
    const result = run([
      row(1, { storeId: "b" }),
      row(2, {
        storeId: "b",
        type: "SALE",
        qtyDelta: -5,
        referenceType: "CustomerOrder",
        referenceId: "sale",
        unitCostKgs: null,
      }),
      row(3, {
        type: "RETURN",
        qtyDelta: 5,
        unitCostKgs: null,
        referenceType: "SaleReturn",
        referenceId: "return",
        originalSaleId: "sale",
      }),
    ]);
    expect(result.current).toMatchObject({
      quantity: 5,
      unitCostKgs: null,
      status: "UNKNOWN",
      reason: "MISSING_RETURN",
    });
  });
  it("does not use the latest global/manual cost as evidence for unvalued opening stock", () => {
    const result = run([
      row(1, { type: "ADJUSTMENT", unitCostKgs: null, referenceType: "INITIAL_STOCK" }),
      row(2, { unitCostKgs: "200" }),
    ]);
    expect(result.current).toMatchObject({
      quantity: 20,
      status: "UNKNOWN",
      reason: "UNVALUED_STOCK",
      unitCostKgs: null,
    });
    expect(result.projected.status).toBe("UNKNOWN");
  });
  it("treats a real zero-cost receipt as known, not missing", () => {
    const result = run([row(1, { unitCostKgs: "0", lineTotalKgs: "0" })], { cost: 0 });
    expect(result.current).toMatchObject({ unitCostKgs: 0, status: "KNOWN" });
    expect(result.projected).toMatchObject({ unitCostKgs: 0, status: "KNOWN" });
  });
  it("preserves the unit rate when a fractional receipt's stored total rounds below a cent", () => {
    const result = run([row(1, { qtyDelta: 0.001, unitCostKgs: "0.01", lineTotalKgs: "0" })], {
      quantity: 0.001,
      cost: 0.01,
    });
    expect(result.current).toMatchObject({ quantity: 0.001, unitCostKgs: 0.01, status: "KNOWN" });
    expect(result.projected).toMatchObject({ quantity: 0.002, unitCostKgs: 0.01, status: "KNOWN" });
    const posted = run([
      row(1, { qtyDelta: 0.001, unitCostKgs: "0.01", lineTotalKgs: "0" }),
      row(2, { qtyDelta: 0.001, unitCostKgs: "0.01", lineTotalKgs: "0" }),
    ]);
    expect(posted.current).toEqual(result.projected);
  });
  it("preserves fractional quantities and rounds only the shown unit cost", () => {
    const result = run(
      [
        row(1, { qtyDelta: 1.5, unitCostKgs: "10.01" }),
        row(2, { type: "SALE", qtyDelta: -0.5, unitCostKgs: null }),
      ],
      { quantity: 0.5, cost: 20 },
    );
    expect(result.current).toMatchObject({ quantity: 1, unitCostKgs: 10.01, status: "KNOWN" });
    expect(result.projected).toMatchObject({ quantity: 1.5, unitCostKgs: 13.34, status: "KNOWN" });
  });
  it("reports negative inventory instead of dividing a deficit into a plausible cost", () => {
    const result = run([row(1, { type: "SALE", qtyDelta: -2, unitCostKgs: null })]);
    expect(result.current).toMatchObject({
      quantity: -2,
      unitCostKgs: null,
      reason: "NEGATIVE_STOCK",
    });
    expect(result.projected).toMatchObject({
      quantity: 8,
      unitCostKgs: null,
      reason: "NEGATIVE_STOCK",
    });
  });
  it("recovers after unknown stock has been fully depleted and new valued stock arrives", () => {
    const result = run([
      row(1, { type: "ADJUSTMENT", unitCostKgs: null }),
      row(2, { type: "SALE", qtyDelta: -10, unitCostKgs: null }),
      row(3, { unitCostKgs: "42" }),
    ]);
    expect(result.current).toMatchObject({ quantity: 10, unitCostKgs: 42, status: "KNOWN" });
  });
  it("recovers after a deficit is exactly covered to zero", () => {
    const result = run([
      row(1, { type: "SALE", qtyDelta: -2, unitCostKgs: null }),
      row(2, { qtyDelta: 2, unitCostKgs: "42" }),
      row(3, { unitCostKgs: "60" }),
    ]);
    expect(result.current).toMatchObject({ unitCostKgs: 60, status: "KNOWN" });
  });
  it("compares the stream with the selected store's actual quantity", () => {
    const result = run([row(1)], {
      snapshots: [{ storeId: "a", productId: "p", variantId: null, onHand: 11 }],
    });
    expect(result.current).toMatchObject({
      quantity: 11,
      status: "UNKNOWN",
      reason: "SNAPSHOT_MISMATCH",
    });
    expect(result.projected).toMatchObject({
      quantity: 21,
      status: "UNKNOWN",
      reason: "SNAPSHOT_MISMATCH",
    });
  });
  it("does not taint a selected store because an unrelated store has mismatched history", () => {
    const result = run([row(1), row(2, { storeId: "b", unitCostKgs: "900" })], {
      snapshots: [
        { storeId: "a", productId: "p", variantId: null, onHand: 10 },
        { storeId: "b", productId: "p", variantId: null, onHand: 11 },
      ],
    });
    expect(result.current).toMatchObject({ quantity: 10, unitCostKgs: 100, status: "KNOWN" });
  });
  it("does not propagate an apparently known transfer value from a source with missing history", () => {
    const result = run(
      [
        row(1, { storeId: "b" }),
        row(2, {
          storeId: "b",
          type: "TRANSFER_OUT",
          qtyDelta: -5,
          referenceType: "TRANSFER",
          referenceId: "t",
        }),
        row(3, {
          type: "TRANSFER_IN",
          qtyDelta: 5,
          unitCostKgs: null,
          referenceType: "TRANSFER",
          referenceId: "t",
        }),
      ],
      {
        snapshots: [
          { storeId: "b", productId: "p", variantId: null, onHand: 10 },
          { storeId: "a", productId: "p", variantId: null, onHand: 5 },
        ],
      },
    );
    expect(result.current).toMatchObject({ quantity: 5, status: "UNKNOWN", unitCostKgs: null });
  });
  it("rejects an unmatched transfer-in as missing provenance", () => {
    const result = run([
      row(1, {
        type: "TRANSFER_IN",
        unitCostKgs: "999",
        referenceType: "TRANSFER",
        referenceId: "missing",
      }),
    ]);
    expect(result.current).toMatchObject({ status: "UNKNOWN", reason: "MISSING_TRANSFER" });
  });
  it("flags transfer corrections rather than silently repricing them at today's source rate", () => {
    const result = run([
      row(1, { storeId: "b", qtyDelta: 20 }),
      row(2, {
        storeId: "b",
        type: "TRANSFER_OUT",
        qtyDelta: -10,
        referenceType: "TRANSFER",
        referenceId: "t",
      }),
      row(3, {
        type: "TRANSFER_IN",
        qtyDelta: 10,
        unitCostKgs: null,
        referenceType: "TRANSFER",
        referenceId: "t",
      }),
      row(4, {
        storeId: "b",
        type: "TRANSFER_OUT",
        qtyDelta: 2,
        referenceType: "TRANSFER",
        referenceId: "t",
      }),
      row(5, {
        type: "TRANSFER_IN",
        qtyDelta: -2,
        unitCostKgs: null,
        referenceType: "TRANSFER",
        referenceId: "t",
      }),
    ]);
    expect(result.current).toMatchObject({
      quantity: 8,
      status: "UNKNOWN",
      reason: "AMBIGUOUS_CORRECTION",
    });
  });
  it("restores original issued cost on a positive SALE correction", () => {
    const result = run([
      row(1),
      row(2, {
        type: "SALE",
        qtyDelta: -5,
        referenceType: "CustomerOrder",
        referenceId: "s",
        unitCostKgs: null,
      }),
      row(3, { unitCostKgs: "200" }),
      row(4, {
        type: "SALE",
        qtyDelta: 5,
        referenceType: "CustomerOrder",
        referenceId: "s",
        unitCostKgs: null,
      }),
    ]);
    expect(result.current).toMatchObject({ quantity: 20, unitCostKgs: 150, status: "KNOWN" });
  });
  it("flags cost-only changes to a historical receipt as an ambiguous correction", () => {
    const result = run([
      row(1),
      row(2, { qtyDelta: 0, lineTotalKgs: "5", unitCostKgs: "100", referenceId: "receipt1" }),
    ]);
    expect(result.current).toMatchObject({
      quantity: 10,
      status: "UNKNOWN",
      reason: "AMBIGUOUS_CORRECTION",
    });
  });
  it("does not present partial history as a reliable average", () => {
    const result = run([row(1)], { truncated: true });
    expect(result.current).toMatchObject({
      quantity: 10,
      status: "UNKNOWN",
      reason: "HISTORY_LIMIT",
    });
    expect(result.projected.status).toBe("UNKNOWN");
  });
  it("can value a new receipt when the actual old balance is zero even if old history exceeded the cap", () => {
    const result = run([], { truncated: true });
    expect(result.current).toMatchObject({ quantity: 0, status: "UNKNOWN", reason: "NO_STOCK" });
    expect(result.projected).toMatchObject({ quantity: 10, unitCostKgs: 200, status: "KNOWN" });
  });
  it("replays a backdated receipt before later issues instead of appending it to current stock", () => {
    const result = run([row(1), row(3, { type: "SALE", qtyDelta: -5, unitCostKgs: null })], {
      movementDate: new Date("2026-01-01T00:00:02Z"),
    });
    expect(result.current).toMatchObject({ quantity: 5, unitCostKgs: 100, status: "KNOWN" });
    expect(result.projected).toMatchObject({
      quantity: 15,
      status: "KNOWN",
      reason: null,
      unitCostKgs: 150,
    });
  });
  it("does not invent an ordering for a backdated receipt tied exactly with an issue timestamp", () => {
    const result = run([row(1), row(3, { type: "SALE", qtyDelta: -5, unitCostKgs: null })], {
      movementDate: new Date("2026-01-01T00:00:03Z"),
    });
    expect(result.projected).toMatchObject({
      quantity: 15,
      status: "UNKNOWN",
      reason: "BACKDATED",
      unitCostKgs: null,
    });
  });
  it("does not claim historical precision when existing receipts and issues share an ambiguous timestamp", () => {
    const result = run([
      row(1),
      row(2, { type: "SALE", qtyDelta: -5, unitCostKgs: null, createdAt: "2026-01-01T00:00:03Z" }),
      row(3, { unitCostKgs: "200" }),
    ]);
    expect(result.current).toMatchObject({
      quantity: 15,
      unitCostKgs: null,
      status: "UNKNOWN",
      reason: "BACKDATED",
    });
  });
  it("does not discard unknown older stock because the current balance is zero when the receipt is backdated", () => {
    const result = run(
      [
        row(1, { type: "ADJUSTMENT", unitCostKgs: null }),
        row(3, { type: "SALE", qtyDelta: -10, unitCostKgs: null }),
      ],
      { movementDate: new Date("2026-01-01T00:00:02Z") },
    );
    expect(result.current).toMatchObject({ quantity: 0, reason: "NO_STOCK" });
    expect(result.projected).toMatchObject({
      quantity: 10,
      status: "UNKNOWN",
      reason: "UNVALUED_STOCK",
    });
  });
  it("does not mutate caller data", () => {
    const source = [row(1), row(2, { type: "SALE", qtyDelta: -1, unitCostKgs: null })];
    const before = structuredClone(source);
    run(source);
    expect(source).toEqual(before);
  });
});
