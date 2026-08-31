import { Prisma } from "@prisma/client";

export type FrozenMovementCostInput = {
  qtyDelta: number;
  unitCostKgs: Prisma.Decimal | number | null;
  lineTotalKgs: Prisma.Decimal | number | null;
  inventoryValueDeltaKgs: Prisma.Decimal | number | null;
};

/** Resolve historical movement COGS without consulting today's ProductCost row. */
export const resolveFrozenMovementCost = (input: FrozenMovementCostInput) => {
  const storedTotal = input.inventoryValueDeltaKgs ?? input.lineTotalKgs;
  const storedUnit = input.unitCostKgs;
  let total = storedTotal === null ? null : new Prisma.Decimal(storedTotal.toString());
  if (total === null && storedUnit !== null) {
    total = new Prisma.Decimal(storedUnit.toString()).mul(input.qtyDelta);
  }

  const unit =
    total !== null && input.qtyDelta !== 0
      ? total.div(input.qtyDelta).abs()
      : storedUnit === null
        ? null
        : new Prisma.Decimal(storedUnit.toString()).abs();

  return {
    unitCostKgs: unit === null ? null : Number(unit),
    totalCostKgs: total === null ? null : Number(total),
  };
};
