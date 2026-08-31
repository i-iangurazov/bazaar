// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("qz-tray", () => ({ default: {} }));

import { getQzTrayBinding, qzTrayBindingKey, saveQzTrayBinding } from "@/lib/qzTrayPrint";

describe("QZ Tray local binding", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists only printer choices and a non-sensitive trust acknowledgement", () => {
    saveQzTrayBinding("store-1", {
      receiptPrinterName: " Receipt Printer ",
      labelPrinterName: " Label Printer ",
      trustAcknowledged: true,
    });

    const raw = window.localStorage.getItem(qzTrayBindingKey("store-1"));
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw ?? "{}") as unknown).toEqual({
      receiptPrinterName: "Receipt Printer",
      labelPrinterName: "Label Printer",
      trustAcknowledged: true,
    });
    expect(raw).not.toContain("certificateProvisioned");
  });

  it("reads the legacy boolean without treating it as certificate material", () => {
    window.localStorage.setItem(
      qzTrayBindingKey("store-legacy"),
      JSON.stringify({
        receiptPrinterName: "Legacy Receipt",
        labelPrinterName: "Legacy Label",
        certificateProvisioned: true,
      }),
    );

    expect(getQzTrayBinding("store-legacy")).toEqual({
      receiptPrinterName: "Legacy Receipt",
      labelPrinterName: "Legacy Label",
      trustAcknowledged: true,
    });
  });
});
