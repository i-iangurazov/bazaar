import { describe, expect, it } from "vitest";
import {
  clearPendingSalesOrderSale,
  isSafeSalesOrderFailure,
  readPendingSalesOrderSale,
  writePendingSalesOrderSale,
  type PendingSalesOrderSale,
} from "@/lib/salesOrderPendingSale";

const owner = { userId: "operator-one", organizationId: "organization-one" };
const pending: PendingSalesOrderSale = {
  version: 1,
  ...owner,
  storeName: "Магазин",
  totalLabel: "137,00 KGS",
  input: {
    storeId: "store-one",
    idempotencyKey: "retry-original-key",
    priceMode: "WHOLESALE",
    customerId: null,
    lines: [{ productId: "product-one", variantId: null, qty: 2, unitPriceKgs: 68.5 }],
  },
};
const storage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
};

describe("recovering an immediate sale after a lost response", () => {
  it("restores the exact price, quantity, customer-clear flag and retry identity after reload", () => {
    const s = storage();
    writePendingSalesOrderSale(s, pending);
    expect(readPendingSalesOrderSale(s, owner)).toEqual(pending);
  });
  it("separates organizations and users on the same browser", () => {
    const s = storage();
    writePendingSalesOrderSale(s, pending);
    expect(readPendingSalesOrderSale(s, { ...owner, userId: "another-user" })).toBeNull();
    expect(readPendingSalesOrderSale(s, { ...owner, organizationId: "another-org" })).toBeNull();
  });
  it("a late response cannot remove a newer pending sale", () => {
    const s = storage();
    writePendingSalesOrderSale(s, pending);
    const newer = { ...pending, input: { ...pending.input, idempotencyKey: "a-newer-retry-key" } };
    writePendingSalesOrderSale(s, newer);
    clearPendingSalesOrderSale(s, pending);
    expect(readPendingSalesOrderSale(s, owner)).toEqual(newer);
    clearPendingSalesOrderSale(s, newer);
    expect(readPendingSalesOrderSale(s, owner)).toBeNull();
  });
  it("does not pretend a denied storage write succeeded", () => {
    expect(() =>
      writePendingSalesOrderSale(
        {
          ...storage(),
          setItem() {
            throw new Error("storage denied");
          },
        },
        pending,
      ),
    ).toThrow("storage denied");
  });
  it("keeps ambiguous failures frozen and releases a known rolled-back domain error", () => {
    for (const e of [
      {},
      { data: { code: "INTERNAL_SERVER_ERROR" } },
      { message: "requestInProgress", data: { code: "CONFLICT" } },
      { data: { code: "UNAUTHORIZED" } },
      { data: { code: "FORBIDDEN" } },
      { data: { code: "BAD_REQUEST" } },
      { message: "operationRequestReconciliationRequired", data: { code: "CONFLICT" } },
    ])
      expect(isSafeSalesOrderFailure(e)).toBe(false);
    expect(
      isSafeSalesOrderFailure({ message: "insufficientStock", data: { code: "CONFLICT" } }),
    ).toBe(true);
    expect(
      isSafeSalesOrderFailure({ message: "salesOrderEmpty", data: { code: "BAD_REQUEST" } }),
    ).toBe(true);
  });
});
