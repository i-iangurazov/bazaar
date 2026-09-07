import { appRoutes } from "@/lib/appRoutes";

export const POS_CASH_MOVEMENT_ANCHOR = "cash-movement";
export const POS_CASH_MOVEMENT_QUERY_PARAM = "cashMovementType";

export const posCashMovementTypes = ["PAY_IN", "PAY_OUT"] as const;

export type PosCashMovementType = (typeof posCashMovementTypes)[number];

export const parsePosCashMovementType = (value: string | null): PosCashMovementType | null =>
  value === "PAY_IN" || value === "PAY_OUT" ? value : null;

export const buildPosCashMovementHref = (type?: PosCashMovementType) => {
  const query = type ? `?${POS_CASH_MOVEMENT_QUERY_PARAM}=${type}` : "";
  return `${appRoutes.shifts}${query}#${POS_CASH_MOVEMENT_ANCHOR}`;
};
