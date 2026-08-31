import { describe, expect, it } from "vitest";

import {
  spreadsheetUploadAccept,
  spreadsheetUploadMaxBytes,
  validateSpreadsheetUploadFile,
} from "@/lib/spreadsheetUpload";

describe("spreadsheet upload boundary", () => {
  it("accepts the actual CSV and Excel formats exposed by both import controls", () => {
    expect(spreadsheetUploadAccept).toBe(".csv,text/csv,.xlsx,.xls");
    expect(
      validateSpreadsheetUploadFile({ name: "customers.csv", size: 1, type: "text/csv" }),
    ).toEqual({ ok: true, extension: "csv" });
    expect(
      validateSpreadsheetUploadFile({
        name: "products.xlsx",
        size: spreadsheetUploadMaxBytes,
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toEqual({ ok: true, extension: "xlsx" });
    expect(
      validateSpreadsheetUploadFile({
        name: "legacy.XLS",
        size: 128,
        type: "application/octet-stream",
      }),
    ).toEqual({ ok: true, extension: "xls" });
  });

  it("rejects empty, unsupported, mime-spoofed, and oversized files before parsing", () => {
    expect(validateSpreadsheetUploadFile({ name: "empty.csv", size: 0, type: "text/csv" })).toEqual(
      { ok: false, code: "fileEmpty" },
    );
    expect(
      validateSpreadsheetUploadFile({ name: "customers.exe", size: 1, type: "text/csv" }),
    ).toEqual({ ok: false, code: "fileInvalidType" });
    expect(
      validateSpreadsheetUploadFile({ name: "customers.csv", size: 1, type: "image/png" }),
    ).toEqual({ ok: false, code: "fileInvalidType" });
    expect(
      validateSpreadsheetUploadFile({
        name: "customers.csv",
        size: spreadsheetUploadMaxBytes + 1,
        type: "text/csv",
      }),
    ).toEqual({ ok: false, code: "importTooLarge" });
  });
});
