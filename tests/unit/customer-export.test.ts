import { describe, expect, it, vi } from "vitest";

import {
  buildCustomerExportTable,
  CUSTOMER_EXPORT_COLUMN_KEYS,
  type CustomerExportColumnKey,
} from "@/lib/customerExport";

const labels = Object.fromEntries(
  CUSTOMER_EXPORT_COLUMN_KEYS.map((key) => [key, `label:${key}`]),
) as Record<CustomerExportColumnKey, string>;

const customer = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: null,
  address: "Bishkek",
  source: "MANUAL",
  createdAt: "2026-07-01T10:00:00.000Z",
  lastOrderAt: null,
  orderCount: 3,
};

describe("customer export table", () => {
  it("exports only selected columns in the canonical business order", () => {
    const table = buildCustomerExportTable({
      customers: [customer],
      selectedColumns: ["email", "name"],
      labels,
      formatDate: (value) => String(value),
      formatSource: (value) => value,
    });

    expect(table).toEqual({
      header: ["label:name", "label:email"],
      rows: [["Ada Lovelace", "ada@example.com"]],
    });
  });

  it("formats dates and sources while preserving blank optional values", () => {
    const formatDate = vi.fn((value: Date | string) => `date:${String(value).slice(0, 10)}`);
    const formatSource = vi.fn((value: string) => `source:${value.toLowerCase()}`);
    const table = buildCustomerExportTable({
      customers: [customer],
      selectedColumns: [...CUSTOMER_EXPORT_COLUMN_KEYS],
      labels,
      formatDate,
      formatSource,
    });

    expect(table.rows[0]).toEqual([
      "Ada Lovelace",
      "ada@example.com",
      "",
      "Bishkek",
      "source:manual",
      "date:2026-07-01",
      "",
      "3",
    ]);
    expect(formatDate).toHaveBeenCalledTimes(1);
    expect(formatSource).toHaveBeenCalledWith("MANUAL");
  });
});
