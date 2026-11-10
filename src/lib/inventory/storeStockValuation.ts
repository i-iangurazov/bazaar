import { Prisma } from "@prisma/client";
import { isValidQuantity, roundQuantity } from "@/lib/quantity";
import type { ReceivingCostState } from "@/lib/stockReceivingCommerce";

export type StoreStockValuationReason =
  | "NO_STOCK"
  | "UNVALUED_STOCK"
  | "NEGATIVE_STOCK"
  | "SNAPSHOT_MISMATCH"
  | "HISTORY_LIMIT"
  | "MISSING_TRANSFER"
  | "MISSING_RETURN"
  | "AMBIGUOUS_CORRECTION"
  | "BACKDATED"
  | "INVALID_HISTORY";

export type StoreStockValuationPoint = ReceivingCostState & {
  reason: StoreStockValuationReason | null;
};
export type StoreStockValuationLine = {
  productId: string;
  variantId: string | null;
  current: StoreStockValuationPoint;
  projected: StoreStockValuationPoint;
};
export type StoreStockValuationIncoming = {
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitCost: number;
};
export type StoreStockValuationMovement = {
  id: string;
  storeId: string;
  productId: string;
  variantId: string | null;
  type: "RECEIVE" | "SALE" | "RETURN" | "ADJUSTMENT" | "TRANSFER_IN" | "TRANSFER_OUT" | "WRITE_OFF";
  qtyDelta: number;
  unitCostKgs: string | number | null;
  lineTotalKgs: string | number | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
  originalSaleId?: string | null;
};
export type StoreStockValuationSnapshot = {
  storeId: string;
  productId: string;
  variantId: string | null;
  onHand: number;
};

type CostState = {
  quantity: number;
  value: Prisma.Decimal | null;
  reason: StoreStockValuationReason | null;
};
type IssuedValue = { quantity: number; value: Prisma.Decimal | null };
type ReplayEvent = {
  at: string;
  id: string;
  rows: StoreStockValuationMovement[];
  transfer?: { source: StoreStockValuationMovement; target: StoreStockValuationMovement };
  invalidTransfer?: StoreStockValuationReason;
};

export const storeStockValuationKey = (productId: string, variantId?: string | null) =>
  JSON.stringify([productId, variantId ?? null]);
const empty = (): CostState => ({ quantity: 0, value: new Prisma.Decimal(0), reason: null });
const signedDecimal = (value: string | number | null): Prisma.Decimal | null => {
  if (value === null) return null;
  try {
    const result = new Prisma.Decimal(String(value));
    return result.isFinite() ? result : null;
  } catch {
    return null;
  }
};
const decimal = (value: string | number | null): Prisma.Decimal | null => {
  const parsed = signedDecimal(value);
  return parsed?.gte(0) ? parsed : null;
};
const issueKey = (
  row: StoreStockValuationMovement,
  originalId = row.referenceId,
  referenceType = row.referenceType,
) =>
  originalId
    ? JSON.stringify([row.storeId, referenceType, originalId, row.productId, row.variantId])
    : null;

function point(state: CostState): StoreStockValuationPoint {
  if (state.quantity === 0)
    return { quantity: 0, unitCostKgs: null, status: "UNKNOWN", reason: "NO_STOCK" };
  if (state.quantity < 0)
    return {
      quantity: state.quantity,
      unitCostKgs: null,
      status: "UNKNOWN",
      reason: "NEGATIVE_STOCK",
    };
  if (state.value === null || state.reason)
    return {
      quantity: state.quantity,
      unitCostKgs: null,
      status: "UNKNOWN",
      reason: state.reason ?? "UNVALUED_STOCK",
    };
  return {
    quantity: state.quantity,
    unitCostKgs: Number(state.value.div(state.quantity).toDecimalPlaces(2)),
    status: "KNOWN",
    reason: null,
  };
}

function resetAtZero(state: CostState) {
  if (state.quantity === 0) {
    state.value = new Prisma.Decimal(0);
    state.reason = null;
  }
}
function invalidate(state: CostState, delta: number, reason: StoreStockValuationReason) {
  state.quantity = roundQuantity(state.quantity + delta);
  state.value = null;
  state.reason = state.quantity < 0 ? "NEGATIVE_STOCK" : reason;
  resetAtZero(state);
}
function add(
  state: CostState,
  quantity: number,
  value: Prisma.Decimal | null,
  reason: StoreStockValuationReason = "UNVALUED_STOCK",
) {
  const previousQuantity = state.quantity;
  state.quantity = roundQuantity(previousQuantity + quantity);
  if (previousQuantity < 0 || state.quantity < 0) {
    state.value = null;
    state.reason = "NEGATIVE_STOCK";
  } else if (value === null || state.value === null || state.reason) {
    state.value = null;
    state.reason ??= reason;
  } else state.value = state.value.plus(value);
  resetAtZero(state);
}
function consume(state: CostState, quantity: number): Prisma.Decimal | null {
  const before = state.quantity;
  const value =
    before >= quantity && before > 0 && state.value !== null && !state.reason
      ? state.value.mul(quantity).div(before)
      : null;
  state.quantity = roundQuantity(before - quantity);
  if (state.quantity < 0) {
    state.value = null;
    state.reason = "NEGATIVE_STOCK";
  } else if (value === null) {
    state.value = null;
    state.reason ??= "UNVALUED_STOCK";
  } else state.value = state.value!.minus(value);
  resetAtZero(state);
  return value;
}

function receiptValue(row: StoreStockValuationMovement): Prisma.Decimal | null {
  const total = decimal(row.lineTotalKgs);
  const cost = decimal(row.unitCostKgs);
  if (total && cost && !cost.mul(row.qtyDelta).toDecimalPlaces(2).equals(total)) return null;
  // Line totals are stored in cents, while a fractional unit can carry less
  // than one cent. Retain the evidenced unit rate until the displayed average.
  return cost ? cost.mul(row.qtyDelta) : total;
}

function eventsFor(rows: StoreStockValuationMovement[]): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  const transfers = new Map<string, StoreStockValuationMovement[]>();
  for (const row of rows) {
    if (row.type === "TRANSFER_IN" || row.type === "TRANSFER_OUT") {
      const key =
        row.referenceType && row.referenceId
          ? JSON.stringify([row.referenceType, row.referenceId, row.productId, row.variantId])
          : row.id;
      const group = transfers.get(key) ?? [];
      group.push(row);
      transfers.set(key, group);
    } else events.push({ at: row.createdAt, id: row.id, rows: [row] });
  }
  for (const group of transfers.values()) {
    const source = group.find((row) => row.type === "TRANSFER_OUT" && row.qtyDelta < 0);
    const target = group.find((row) => row.type === "TRANSFER_IN" && row.qtyDelta > 0);
    const ordinary =
      group.length === 2 &&
      source &&
      target &&
      source.storeId !== target.storeId &&
      roundQuantity(source.qtyDelta + target.qtyDelta) === 0;
    if (ordinary) {
      const first = [source, target].sort(
        (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
      )[0];
      events.push({ at: first.createdAt, id: first.id, rows: group, transfer: { source, target } });
    } else {
      const reason =
        group.length > 2 ||
        group.some((row) => (row.type === "TRANSFER_OUT" ? row.qtyDelta >= 0 : row.qtyDelta <= 0))
          ? "AMBIGUOUS_CORRECTION"
          : "MISSING_TRANSFER";
      for (const row of group)
        events.push({ at: row.createdAt, id: row.id, rows: [row], invalidTransfer: reason });
    }
  }
  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
}

/** Reference AVCO from evidenced stock movements, never a rewrite of ProductCost or sale COGS. */
export function replayStoreStockValuation(
  input: {
    storeId: string;
    lines: StoreStockValuationIncoming[];
    movements: StoreStockValuationMovement[];
    snapshots: StoreStockValuationSnapshot[];
    truncatedKeys?: ReadonlySet<string>;
    movementDate?: Date;
    now?: Date;
  },
  currentOnly = false,
): StoreStockValuationLine[] {
  const grouped = new Map<string, StoreStockValuationMovement[]>();
  for (const row of input.movements) {
    const key = storeStockValuationKey(row.productId, row.variantId);
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  const snapshots = new Map<string, Map<string, number>>();
  for (const snapshot of input.snapshots) {
    const key = storeStockValuationKey(snapshot.productId, snapshot.variantId);
    const stores = snapshots.get(key) ?? new Map<string, number>();
    stores.set(snapshot.storeId, snapshot.onHand);
    snapshots.set(key, stores);
  }
  return input.lines.map((line) => {
    const key = storeStockValuationKey(line.productId, line.variantId);
    const rows = grouped.get(key) ?? [];
    const actualQuantities = snapshots.get(key) ?? new Map<string, number>();
    const actualQuantity = actualQuantities.get(input.storeId) ?? 0;
    const states = new Map<string, CostState>();
    const get = (storeId: string) => {
      let state = states.get(storeId);
      if (!state) {
        state = empty();
        states.set(storeId, state);
      }
      return state;
    };
    const totals = new Map<string, number>();
    for (const row of rows)
      totals.set(row.storeId, roundQuantity((totals.get(row.storeId) ?? 0) + row.qtyDelta));
    const mismatch = new Set<string>();
    for (const store of new Set([...totals.keys(), ...actualQuantities.keys()])) {
      const qty = actualQuantities.get(store) ?? 0;
      if (!isValidQuantity(qty) || (totals.get(store) ?? 0) !== qty) mismatch.add(store);
    }
    const issued = new Map<string, IssuedValue>();
    const events = eventsFor(rows);
    const directions = new Map<string, { incoming: boolean; outgoing: boolean }>();
    for (const event of events)
      for (const row of event.rows) {
        const scope = JSON.stringify([Date.parse(event.at), row.storeId]);
        const direction = directions.get(scope) ?? { incoming: false, outgoing: false };
        direction.incoming ||= row.qtyDelta > 0;
        direction.outgoing ||= row.qtyDelta < 0;
        directions.set(scope, direction);
      }
    const ambiguousAt = (storeId: string, at: string) => {
      const direction = directions.get(JSON.stringify([Date.parse(at), storeId]));
      return Boolean(direction?.incoming && direction.outgoing);
    };
    const rememberIssue = (
      row: StoreStockValuationMovement,
      quantity: number,
      value: Prisma.Decimal | null,
    ) => {
      const key = issueKey(row);
      if (!key) return;
      const previous = issued.get(key);
      issued.set(key, {
        quantity: roundQuantity((previous?.quantity ?? 0) + quantity),
        value:
          value === null || previous?.value === null
            ? null
            : (previous?.value ?? new Prisma.Decimal(0)).plus(value),
      });
    };
    const restore = (
      row: StoreStockValuationMovement,
      originalId: string | null | undefined,
      reason: StoreStockValuationReason,
    ) => {
      const state = get(row.storeId);
      const key = originalId
        ? issueKey(
            row,
            originalId,
            row.referenceType === "SaleReturn" ? "CustomerOrder" : row.referenceType,
          )
        : null;
      const previous = key ? issued.get(key) : null;
      if (!previous || previous.quantity < row.qtyDelta || previous.value === null) {
        add(state, row.qtyDelta, null, reason);
        return;
      }
      const value = previous.value.mul(row.qtyDelta).div(previous.quantity);
      add(state, row.qtyDelta, value);
      previous.quantity = roundQuantity(previous.quantity - row.qtyDelta);
      previous.value = previous.value.minus(value);
    };
    if (!input.truncatedKeys?.has(key))
      for (const event of events) {
        if (event.transfer) {
          const { source, target } = event.transfer;
          const sourceState = get(source.storeId);
          if (mismatch.has(source.storeId)) {
            sourceState.value = null;
            sourceState.reason = "SNAPSHOT_MISMATCH";
          }
          if (ambiguousAt(source.storeId, event.at)) {
            sourceState.value = null;
            sourceState.reason = "BACKDATED";
          }
          const value = consume(sourceState, -source.qtyDelta);
          const targetState = get(target.storeId);
          if (ambiguousAt(target.storeId, event.at)) {
            targetState.value = null;
            targetState.reason = "BACKDATED";
          }
          add(targetState, target.qtyDelta, value, "MISSING_TRANSFER");
          continue;
        }
        const row = event.rows[0],
          state = get(row.storeId);
        if (!isValidQuantity(row.qtyDelta) || !Number.isFinite(Date.parse(row.createdAt))) {
          invalidate(state, Number.isFinite(row.qtyDelta) ? row.qtyDelta : 0, "INVALID_HISTORY");
          continue;
        }
        if (mismatch.has(row.storeId)) {
          state.value = null;
          state.reason = "SNAPSHOT_MISMATCH";
        }
        if (ambiguousAt(row.storeId, event.at)) {
          state.value = null;
          state.reason = "BACKDATED";
        }
        if (event.invalidTransfer) {
          invalidate(state, row.qtyDelta, event.invalidTransfer);
          continue;
        }
        if (row.qtyDelta === 0) {
          const total = signedDecimal(row.lineTotalKgs);
          if (row.lineTotalKgs !== null && !total) invalidate(state, 0, "INVALID_HISTORY");
          else if (total && !total.equals(0)) invalidate(state, 0, "AMBIGUOUS_CORRECTION");
          continue;
        }
        if (row.type === "RECEIVE" || (row.type === "ADJUSTMENT" && row.qtyDelta > 0)) {
          if (row.qtyDelta < 0 || row.referenceType === "IMPORT_ROLLBACK")
            invalidate(state, row.qtyDelta, "AMBIGUOUS_CORRECTION");
          else add(state, row.qtyDelta, receiptValue(row));
        } else if (
          row.type === "RETURN" ||
          (row.type === "SALE" && row.qtyDelta > 0) ||
          (row.type === "WRITE_OFF" && row.qtyDelta > 0)
        ) {
          if (row.qtyDelta < 0) invalidate(state, row.qtyDelta, "AMBIGUOUS_CORRECTION");
          else
            restore(
              row,
              row.referenceType === "SaleReturn" ? row.originalSaleId : row.referenceId,
              row.type === "WRITE_OFF" ? "AMBIGUOUS_CORRECTION" : "MISSING_RETURN",
            );
        } else if (row.qtyDelta < 0) {
          const value = consume(state, -row.qtyDelta);
          if (row.type === "SALE" || row.type === "WRITE_OFF")
            rememberIssue(row, -row.qtyDelta, value);
        } else invalidate(state, row.qtyDelta, "UNVALUED_STOCK");
      }
    let state = get(input.storeId);
    if (actualQuantity === 0) state = empty();
    else if (input.truncatedKeys?.has(key))
      state = { quantity: actualQuantity, value: null, reason: "HISTORY_LIMIT" };
    else if (mismatch.has(input.storeId))
      state = { quantity: actualQuantity, value: null, reason: "SNAPSHOT_MISMATCH" };
    const current = point(state);
    if (currentOnly)
      return {
        productId: line.productId,
        variantId: line.variantId ?? null,
        current,
        projected: current,
      };
    const projectedState = { ...state };
    const latestTime = rows.reduce((latest, row) => Math.max(latest, Date.parse(row.createdAt)), 0);
    const desiredTime = (input.movementDate ?? input.now ?? new Date()).getTime();
    if (
      !isValidQuantity(line.quantity) ||
      line.quantity <= 0 ||
      decimal(line.unitCost) === null ||
      !Number.isFinite(desiredTime)
    )
      invalidate(projectedState, 0, "INVALID_HISTORY");
    else if (
      rows.some(
        (row) =>
          Date.parse(row.createdAt) === desiredTime &&
          !((row.type === "RECEIVE" || row.type === "ADJUSTMENT") && row.qtyDelta > 0),
      )
    )
      // An exact timestamp tie with an issue/transfer has no reliable persisted
      // sequence; do not choose an order merely because a synthetic ID sorts last.
      invalidate(projectedState, line.quantity, "BACKDATED");
    else if (latestTime > desiredTime) {
      const projectedSnapshots = [...actualQuantities].map(([storeId, onHand]) => ({
        storeId,
        productId: line.productId,
        variantId: line.variantId ?? null,
        onHand: storeId === input.storeId ? roundQuantity(onHand + line.quantity) : onHand,
      }));
      if (!actualQuantities.has(input.storeId))
        projectedSnapshots.push({
          storeId: input.storeId,
          productId: line.productId,
          variantId: line.variantId ?? null,
          onHand: line.quantity,
        });
      let syntheticId = "~receiving-valuation-preview";
      const ids = new Set(rows.map((row) => row.id));
      while (ids.has(syntheticId)) syntheticId += "~";
      const synthetic: StoreStockValuationMovement = {
        id: syntheticId,
        storeId: input.storeId,
        productId: line.productId,
        variantId: line.variantId ?? null,
        type: "RECEIVE",
        qtyDelta: line.quantity,
        unitCostKgs: String(line.unitCost),
        lineTotalKgs: new Prisma.Decimal(line.unitCost)
          .mul(line.quantity)
          .toDecimalPlaces(2)
          .toString(),
        referenceType: "STOCK_RECEIVING_PREVIEW",
        referenceId: syntheticId,
        createdAt: new Date(desiredTime).toISOString(),
      };
      // This is a second, bounded read-model replay. Financial sale snapshots
      // remain untouched even when this reference stock valuation is backdated.
      const projected = replayStoreStockValuation(
        {
          ...input,
          lines: [line],
          movements: [...rows, synthetic],
          snapshots: projectedSnapshots,
        },
        true,
      )[0].current;
      return { productId: line.productId, variantId: line.variantId ?? null, current, projected };
    } else add(projectedState, line.quantity, new Prisma.Decimal(line.unitCost).mul(line.quantity));
    return {
      productId: line.productId,
      variantId: line.variantId ?? null,
      current,
      projected: point(projectedState),
    };
  });
}
