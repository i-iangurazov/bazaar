import { beforeEach, describe, expect, it, vi } from "vitest";

import CashPage from "@/app/(app)/cash/page";
import FinanceExpensePage from "@/app/(app)/finance/expense/page";
import FinanceIncomePage from "@/app/(app)/finance/income/page";
import {
  buildPosCashMovementHref,
  parsePosCashMovementType,
} from "@/lib/posCashMovementRoute";

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((_href: string): never => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: navigation.redirect,
}));

describe("canonical POS cash movement routes", () => {
  beforeEach(() => {
    navigation.redirect.mockClear();
  });

  it("builds canonical anchored links with explicit income and expense types", () => {
    expect(buildPosCashMovementHref()).toBe("/pos/shifts#cash-movement");
    expect(buildPosCashMovementHref("PAY_IN")).toBe(
      "/pos/shifts?cashMovementType=PAY_IN#cash-movement",
    );
    expect(buildPosCashMovementHref("PAY_OUT")).toBe(
      "/pos/shifts?cashMovementType=PAY_OUT#cash-movement",
    );
  });

  it("accepts only supported cash movement type selections", () => {
    expect(parsePosCashMovementType("PAY_IN")).toBe("PAY_IN");
    expect(parsePosCashMovementType("PAY_OUT")).toBe("PAY_OUT");
    expect(parsePosCashMovementType("pay_in")).toBeNull();
    expect(parsePosCashMovementType("REFUND")).toBeNull();
    expect(parsePosCashMovementType(null)).toBeNull();
  });

  it.each([
    ["cash", CashPage, "/pos/shifts#cash-movement"],
    ["income", FinanceIncomePage, "/pos/shifts?cashMovementType=PAY_IN#cash-movement"],
    ["expense", FinanceExpensePage, "/pos/shifts?cashMovementType=PAY_OUT#cash-movement"],
  ])("redirects %s to the real POS workflow", (_name, Page, expectedHref) => {
    expect(() => Page()).toThrow("NEXT_REDIRECT");
    expect(navigation.redirect).toHaveBeenCalledTimes(1);
    expect(navigation.redirect).toHaveBeenCalledWith(expectedHref);
  });
});
